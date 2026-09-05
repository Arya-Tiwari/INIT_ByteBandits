"""Local constrained allocation proposal, never execution.

Phase 1: HiGHS LP establishes feasibility of capital, locks, allocation, liquidity
and turnover constraints. Phase 2: SLSQP minimizes historical variance subject to
ALL shared Firewall margins. A candidate is returned only after an independent
Firewall recheck. Nonlinear solver failure is NOT a proof of infeasibility.
"""
import numpy as np
from scipy.optimize import linprog, minimize
from . import firewall
from .models import RebalanceResult, Trade

TRADE_LIQUIDITY_FLOOR = 70
MINIMUM_TRADE_AMOUNT = 1000.0  # INR, including cash movements


def optimize(assets, returns, limits, original_capital=None, consumed_turnover=0):
    total = sum(a.currentValue for a in assets)
    original_capital = total if original_capital is None else original_capital
    empty = dict(totalValue=total, limits=limits, cumulativeTurnover=consumed_turnover, minimumTradeAmount=MINIMUM_TRADE_AMOUNT)
    if total <= 0:
        return RebalanceResult(status='INFEASIBLE', explanation='No remaining capital can fund a rebalance. Zero-value holdings have zero weights.',
            conflicts=['Capital is zero; no external capital may be introduced.'], **empty)
    w0 = np.array([a.currentValue/total for a in assets])
    n = len(assets)
    factor = total/original_capital
    locked = np.array([a.liquidityScore < TRADE_LIQUIDITY_FLOOR or (a.currentValue == 0 and a.assetClass != 'Cash') for a in assets])
    # Wiped-out securities cannot be purchased without a price model.
    # An exhausted cash balance remains a valid destination for sale proceeds.
    bounds = [(float(w),float(w)) if lock else (0,1) for w,lock in zip(w0,locked)] + [(0,1)]*n
    rows, rhs, groups = [], [], []
    def add(row, bound, group):
        rows.append(row); rhs.append(bound); groups.append(group)
    for i in range(n):
        row=np.zeros(2*n); row[i]=1
        add(row,limits.maxSingleAssetWeight,'Single asset cap')
        row=np.zeros(2*n); row[i]=1; row[n+i]=-1
        add(row,w0[i],'Trade accounting')
        row=np.zeros(2*n); row[i]=-1; row[n+i]=-1
        add(row,-w0[i],'Trade accounting')
    for cls in {a.assetClass for a in assets}:
        row=np.zeros(2*n); row[:n]=[a.assetClass==cls for a in assets]
        add(row,limits.maxAssetClassWeight,'Asset class cap')
    row=np.zeros(2*n); row[:n]=[-a.liquidityScore/100 for a in assets]
    add(row,-limits.minimumLiquidityScore/100,'Minimum liquidity')
    row=np.zeros(2*n); row[:n]=[-int(a.assetClass=='Cash') for a in assets]
    add(row,-limits.minimumCashWeight,'Minimum cash')
    row=np.zeros(2*n); row[n:]=.5*factor
    add(row,limits.maximumTurnover-consumed_turnover,'Turnover budget')
    equality=np.zeros((1,2*n)); equality[0,:n]=1
    objective=np.r_[np.zeros(n),np.ones(n)]
    def linear(active):
        return linprog(objective,A_ub=np.array(rows)[active],b_ub=np.array(rhs)[active],
            A_eq=equality,b_eq=[1],bounds=bounds,method='highs')
    lp=linear(list(range(len(rows))))
    if not lp.success:
        if lp.status != 2:
            return RebalanceResult(status='NOT_FOUND', explanation='The allocation solver did not establish feasibility. No proposal is presented.', conflicts=[lp.message], **empty)
        # Report which single constraint families restore feasibility if relaxed.
        relaxable=[]
        for group in dict.fromkeys(groups):
            if group != 'Trade accounting' and linear([i for i,g in enumerate(groups) if g != group]).success:
                relaxable.append(group)
        locks=', '.join(a.name for a,l in zip(assets,locked) if l)
        conflicts=[f'{g} conflicts with the other configured constraints.' for g in relaxable]
        if not conflicts: conflicts=['Allocation caps, minimum cash/liquidity and turnover cannot be satisfied together under the current tradability restrictions.']
        for a,w,is_locked in zip(assets,w0,locked):
            if is_locked and w > limits.maxSingleAssetWeight + firewall.TOLERANCE:
                conflicts.append(f'{a.name} is locked at {w:.2%}, exceeding the single-asset cap of {limits.maxSingleAssetWeight:.2%}; the required sale is prohibited.')
        best_liquidity = sum(w*a.liquidityScore for a,w,l in zip(assets,w0,locked) if l)
        free_weight = sum(w for w,l in zip(w0,locked) if not l)
        best_liquidity += free_weight * max([a.liquidityScore for a,l in zip(assets,locked) if not l] or [0])
        if best_liquidity < limits.minimumLiquidityScore - firewall.TOLERANCE:
            conflicts.append(f'Even moving all tradable capital to the most liquid eligible holding yields at most {best_liquidity:.1f}/100 liquidity, below the {limits.minimumLiquidityScore:.1f}/100 minimum.')
        if locks: conflicts.append('Locked holdings (liquidity below 70 or zero value): ' + locks + '.')
        conflicts.append(f'Available capital ₹{total/1e7:.2f} Cr; remaining turnover budget {max(0,limits.maximumTurnover-consumed_turnover):.2%} of original capital.')
        return RebalanceResult(status='INFEASIBLE', explanation='No capital-conserving allocation satisfies the linear constraints. Adjust the conflicting limits or scenario; no trades are proposed.',conflicts=conflicts,**empty)
    covariance=np.atleast_2d(np.cov(returns[[a.id for a in assets]].to_numpy(),rowvar=False))*252
    def portfolio(w):
        return [a.model_copy(update={'currentValue':float(total*x),'currentWeight':float(x)}) for a,x in zip(assets,w)]
    def turnover(w): return float(.5*np.abs(w-w0).sum())
    def report(w): return firewall.inspect_portfolio(portfolio(w),returns,limits,consumed_turnover+turnover(w)*factor)
    def margins(w):
        # Shared Firewall defines every risk policy; the solver does not reimplement VaR/CVaR.
        return np.asarray(firewall.policy_margins(report(w).metrics,limits))
    def objective_risk(w): return float(w@covariance@w)+.001*float(np.sum((w-w0)**2))
    candidates = [w0,lp.x[:n]]
    for start in (lp.x[:n],w0):
        result=minimize(objective_risk,start,
            method='SLSQP',bounds=bounds[:n],constraints=[{'type':'eq','fun':lambda w:np.sum(w)-1},
            {'type':'ineq','fun':margins}],options={'maxiter':180,'ftol':1e-11})
        candidates.append(result.x)
    def remove_dust(candidate):
        """Freeze sub-threshold trades and re-solve funding and all policies.

        Never merely hide rows: target holdings must match the funded trades.
        Each pass adds locks, so this is bounded by n+1 passes.
        """
        w = np.maximum(candidate, 0)
        frozen = locked.copy()
        for _ in range(n + 1):
            if not np.isfinite(w).all() or abs(w.sum()-1)>1e-7: return None
            delta = (w-w0)*total
            tiny = (np.abs(delta) < MINIMUM_TRADE_AMOUNT) & ~frozen
            if not tiny.any():
                w[frozen] = w0[frozen]
                movable = np.flatnonzero(~frozen)
                residual = 1-w.sum()
                if len(movable):
                    index = movable[np.argmax(np.abs(w[movable]-w0[movable]))]
                    w[index] += residual
                elif abs(residual)>1e-10: return None
                if np.any(w < 0) or np.any(np.abs(w[locked]-w0[locked])>1e-10): return None
                amounts = np.abs(w-w0)*total
                if np.any((amounts>.01)&(amounts<MINIMUM_TRADE_AMOUNT-.01)): return None
                return w
            frozen |= tiny
            reduced_bounds = [(float(w0[i]),float(w0[i])) if frozen[i] else bounds[i] for i in range(n)]
            refined = minimize(objective_risk,w,method='SLSQP',bounds=reduced_bounds,
                constraints=[{'type':'eq','fun':lambda x:np.sum(x)-1}, {'type':'ineq','fun':margins}],
                options={'maxiter':180,'ftol':1e-11})
            w = np.maximum(refined.x,0)
        return None

    accepted=[]
    for candidate in candidates:
        w=remove_dust(candidate)
        if w is None: continue
        checked=report(w)
        if not any(c.status=='BREACH' for c in checked.controls): accepted.append((objective_risk(w),w,checked))
    if not accepted:
        nearest=min(candidates,key=lambda w:float(np.square(np.minimum(margins(w),0)).sum()))
        checked=report(np.maximum(nearest,0)/np.maximum(nearest,0).sum())
        conflicts=[c.explanation for c in checked.controls if c.status=='BREACH']
        return RebalanceResult(status='NOT_FOUND',explanation='Linear funding constraints are feasible, but the numerical solver did not find an allocation passing every risk limit and the minimum-trade threshold. This is not a proof that none exists; no trades are proposed.',conflicts=conflicts,**empty)
    _,w,checked=min(accepted,key=lambda item:item[0])
    proposed=portfolio(w)
    trades=[]
    for a,b,lock in zip(assets,proposed,locked):
        delta=b.currentValue-a.currentValue
        trades.append(Trade(assetId=a.id,name=a.name,action='HOLD' if abs(delta)<.01 else 'BUY' if delta>0 else 'SELL',
            amount=abs(delta),stressedWeight=a.currentValue/total,targetWeight=b.currentWeight,targetValue=b.currentValue,
            liquidityScore=a.liquidityScore,locked=bool(lock)))
    before=firewall.inspect_portfolio(assets,returns,limits,consumed_turnover)
    return RebalanceResult(status='FEASIBLE',minimumTradeAmount=MINIMUM_TRADE_AMOUNT, explanation='Sub-threshold trades were frozen and the allocation was re-solved for funding and policy compliance. A funded proposal passes every Risk Firewall limit. Sales fund purchases; no external capital is added. Holdings with liquidity below 70 and wiped-out positions remain locked. No trades have been executed.',
        trades=trades,assets=proposed,risk=checked,firewallChanges=firewall.transitions(before,checked),
        turnover=turnover(w),cumulativeTurnover=checked.metrics.turnover,totalValue=total,limits=limits)
