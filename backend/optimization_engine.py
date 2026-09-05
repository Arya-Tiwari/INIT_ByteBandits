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
TRANSACTION_COST_RATE = 0.0015
MAX_EXPECTED_RETURN_REDUCTION = 0.02


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
    before=firewall.inspect_portfolio(assets,returns,limits,consumed_turnover)
    expected_returns = np.array([a.expectedReturn for a in assets], dtype=float)
    expected_return_floor = before.metrics.expectedReturn - MAX_EXPECTED_RETURN_REDUCTION

    def unchanged_result():
        trades=[Trade(assetId=a.id,name=a.name,action='HOLD',amount=0,
            stressedWeight=float(w),targetWeight=float(w),targetValue=a.currentValue,
            liquidityScore=a.liquidityScore,locked=a.liquidityScore < TRADE_LIQUIDITY_FLOOR,
            reason=f'{a.name} remains at {w:.2%}; every configured control already passes and trading would add cost without a required repair.',
            triggeredConstraint='No breach',riskImpact='No change; all controls remain compliant.')
            for a,w in zip(assets,w0)]
        return RebalanceResult(status='FEASIBLE',
            objective='No repair is required because the input portfolio already passes every Risk Firewall control. The optimizer preserves the portfolio, uses no turnover and incurs no transaction cost.',
            explanation='All configured controls already pass, so the safest cost-aware action is to hold the current allocation. No trades have been executed.',
            trades=trades,assets=[a.model_copy(deep=True) for a in assets],risk=before,
            firewallChanges=firewall.transitions(before,before),turnover=0,
            cumulativeTurnover=consumed_turnover,totalValue=total,limits=limits,
            minimumTradeAmount=MINIMUM_TRADE_AMOUNT,
            costBenefit={'transactionCostBps':15.0,'transactionCost':0.0,'turnoverValue':0.0,
                'safetyScoreChange':0.0,'expectedReturnChange':0.0,'volatilityChange':0.0},
            decisionTrail=[
                {'stage':'risk_analysis','message':f'Portfolio analysed at {before.metrics.volatility:.2%} annualized volatility.'},
                {'stage':'control','message':'Every configured Risk Firewall control passed.'},
                {'stage':'optimization','message':'No mandatory rebalance was generated because unnecessary trading would add cost.'},
            ])
    if not any(control.status == 'BREACH' for control in before.controls):
        return unchanged_result()
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
    row=np.zeros(2*n); row[:n]=-expected_returns
    add(row,-expected_return_floor,'Expected return floor')
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
        policy = firewall.policy_margins(report(w).metrics,limits)
        return np.asarray([*policy, float(w @ expected_returns - expected_return_floor)])
    def objective_risk(w):
        # One-way turnover is also the transaction-cost base, so this term makes
        # the risk objective explicitly cost aware instead of merely smoothing weights.
        return float(w@covariance@w) + TRANSACTION_COST_RATE * turnover(w)
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
        if (not any(c.status=='BREACH' for c in checked.controls)
                and float(w @ expected_returns) + firewall.TOLERANCE >= expected_return_floor):
            accepted.append((objective_risk(w),w,checked))
    if not accepted:
        nearest=min(candidates,key=lambda w:float(np.square(np.minimum(margins(w),0)).sum()))
        checked=report(np.maximum(nearest,0)/np.maximum(nearest,0).sum())
        conflicts=[c.explanation for c in checked.controls if c.status=='BREACH']
        return RebalanceResult(status='NOT_FOUND',explanation='Linear funding constraints are feasible, but the numerical solver did not find an allocation passing every risk limit and the minimum-trade threshold. This is not a proof that none exists; no trades are proposed.',conflicts=conflicts,**empty)
    _,w,checked=min(accepted,key=lambda item:item[0])
    proposed=portfolio(w)
    before_breaches = {c.controlName: c for c in before.controls if c.status == 'BREACH'}
    current_classes = {cls: sum(weight for asset, weight in zip(assets, w0) if asset.assetClass == cls) for cls in {a.assetClass for a in assets}}
    target_classes = {cls: sum(weight for asset, weight in zip(assets, w) if asset.assetClass == cls) for cls in current_classes}
    risk_impact = f'Risk score {before.riskScore:.1f} → {checked.riskScore:.1f}; volatility {before.metrics.volatility:.2%} → {checked.metrics.volatility:.2%}; breaches {len(before_breaches)} → {sum(c.status == "BREACH" for c in checked.controls)}.'
    trades=[]
    for a,b,lock in zip(assets,proposed,locked):
        delta=b.currentValue-a.currentValue
        action='HOLD' if abs(delta)<.01 else 'BUY' if delta>0 else 'SELL'
        change=b.currentWeight-a.currentValue/total
        trigger='Historical variance and transaction-cost objective'
        if action == 'HOLD':
            trigger='Liquidity restriction' if lock else 'No material allocation change'
            reason=(f'{a.name} is locked at {a.currentValue/total:.2%} because its liquidity score is {a.liquidityScore:.0f}/100, below the tradability floor of {TRADE_LIQUIDITY_FLOOR}/100.' if lock else
                f'{a.name} remains at {a.currentValue/total:.2%}; the funded solution requires no trade above ₹{MINIMUM_TRADE_AMOUNT:,.0f}.')
        elif action == 'SELL' and a.currentValue/total > limits.maxSingleAssetWeight:
            trigger='Maximum single asset exposure'
            reason=f'{a.name} is {a.currentValue/total:.2%}, above the {limits.maxSingleAssetWeight:.2%} single-asset limit. Reduce it to {b.currentWeight:.2%} ({abs(change):.2%} of portfolio capital).'
        elif action == 'SELL' and current_classes[a.assetClass] > limits.maxAssetClassWeight and target_classes[a.assetClass] < current_classes[a.assetClass]:
            trigger='Maximum asset class exposure'
            reason=f'{a.assetClass} totals {current_classes[a.assetClass]:.2%}, above the {limits.maxAssetClassWeight:.2%} class limit. Reducing {a.name} from {a.currentValue/total:.2%} to {b.currentWeight:.2%} helps restore compliance.'
        elif action == 'BUY' and a.assetClass == 'Cash' and 'minimumCashWeight' in before_breaches:
            trigger='Minimum cash reserve'
            reason=f'Cash is {before.metrics.cashWeight:.2%}, below the {limits.minimumCashWeight:.2%} minimum. Increase {a.name} from {a.currentValue/total:.2%} to {b.currentWeight:.2%} to restore the reserve.'
        elif action == 'BUY' and 'minimumLiquidityScore' in before_breaches:
            trigger='Minimum portfolio liquidity'
            reason=f'Portfolio liquidity is {before.metrics.liquidityScore:.1f}/100, below the {limits.minimumLiquidityScore:.1f}/100 floor. Increase {a.name} from {a.currentValue/total:.2%} to {b.currentWeight:.2%}; its liquidity score is {a.liquidityScore:.0f}/100.'
        else:
            verb='Increase' if action == 'BUY' else 'Reduce'
            reason=f'{verb} {a.name} from {a.currentValue/total:.2%} to {b.currentWeight:.2%} ({abs(change):.2%} of portfolio capital) as part of the lowest verified historical-variance solution after transaction cost and return constraints.'
        trades.append(Trade(assetId=a.id,name=a.name,action='HOLD' if abs(delta)<.01 else 'BUY' if delta>0 else 'SELL',
            amount=abs(delta),stressedWeight=a.currentValue/total,targetWeight=b.currentWeight,targetValue=b.currentValue,
            liquidityScore=a.liquidityScore,locked=bool(lock),weightChange=change,
            reason=reason,triggeredConstraint=trigger,riskImpact=risk_impact))
    turnover_pct = turnover(w)
    turnover_val = round(turnover_pct * total, 2)
    tx_cost = round(turnover_val * TRANSACTION_COST_RATE, 2)
    safety_score_delta = round(before.riskScore - checked.riskScore, 2)
    ret_delta = round(checked.metrics.expectedReturn - before.metrics.expectedReturn, 4)
    vol_delta = round(checked.metrics.volatility - before.metrics.volatility, 4)
    cost_benefit = {
        "transactionCostBps": 15.0,
        "transactionCost": tx_cost,
        "turnoverValue": turnover_val,
        "safetyScoreChange": safety_score_delta,
        "expectedReturnChange": ret_delta,
        "volatilityChange": vol_delta
    }
    changes = [f'{cls}: {current_classes[cls]:.2%} → {target_classes[cls]:.2%} ({target_classes[cls]-current_classes[cls]:+.2%})'
        for cls in sorted(current_classes) if abs(target_classes[cls]-current_classes[cls]) >= .0001]
    trail = [{'stage':'risk_analysis','message':f'Portfolio analysed at {before.metrics.volatility:.2%} annualized volatility with risk score {before.riskScore:.1f}/100.'}]
    trail.extend({'stage':'control','message':c.explanation} for c in before.controls if c.status == 'BREACH')
    trail.append({'stage':'optimization','message':f'Evaluated funded allocations under a {limits.maximumTurnover:.2%} cumulative turnover ceiling and {expected_return_floor:.2%} expected-return floor.'})
    trail.extend({'stage':'recommendation','message':f'{t.action} {t.name}: {t.stressedWeight:.2%} → {t.targetWeight:.2%}. {t.triggeredConstraint}.'} for t in trades if t.action != 'HOLD')
    remaining=sum(c.status == 'BREACH' for c in checked.controls)
    trail.append({'stage':'verification','message':f'The shared Risk Firewall rechecked the proposal: {remaining} breaches remain and no orders were executed.'})
    return RebalanceResult(status='FEASIBLE',minimumTradeAmount=MINIMUM_TRADE_AMOUNT, explanation=f'Sub-threshold trades were frozen and the allocation was re-solved for funding and policy compliance. The proposal minimizes historical variance plus estimated transaction cost while keeping expected return at or above {expected_return_floor:.2%}. Sales fund purchases; no external capital is added. No trades have been executed.',
        trades=trades,assets=proposed,risk=checked,firewallChanges=firewall.transitions(before,checked),
        turnover=turnover_pct,cumulativeTurnover=checked.metrics.turnover,totalValue=total,limits=limits,costBenefit=cost_benefit,
        changeSummary=changes,decisionTrail=trail)
