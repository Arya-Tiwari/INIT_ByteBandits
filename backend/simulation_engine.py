"""Scenario revaluation only: source portfolio and return history stay unchanged."""
from collections import defaultdict
from .models import Asset, RiskLimits, Scenario, Impact, LiquidityImpact, SimulationResult
from . import firewall
from .scenarios import DEFINITIONS, assumptions


def liquid_capital(assets):
    return sum(a.currentValue for a in assets if a.liquidityScore >= 70)

def simulate(assets, returns, limits: RiskLimits, scenario_id=None, name=None, shocks=None, withdrawal=None, asset_shocks=None):
    original = sum(a.currentValue for a in assets)
    after = [a.model_copy(deep=True) for a in assets]
    available = liquid_capital(assets)
    fulfilled = withdrawal is None or withdrawal <= available + 1e-7
    executed = 0.
    applied = []
    if withdrawal is not None:
        name = 'Capital Withdrawal'
        # All-or-nothing funding: no sale is simulated if liquid capital is insufficient.
        if fulfilled:
            remaining = withdrawal
            for a in sorted(after,key=lambda a: (a.assetClass != 'Cash', -a.liquidityScore)):
                if a.liquidityScore < 70: continue
                sold = min(remaining, a.currentValue)
                a.currentValue -= sold; remaining -= sold
            executed = withdrawal
    else:
        if scenario_id: name = DEFINITIONS[scenario_id]['name']
        applied = assumptions(assets, scenario_id, shocks, asset_shocks)
        for a, assumption in zip(after, applied):
            a.currentValue *= 1 + assumption.shockPercent / 100
            a.liquidityScore = assumption.liquidityAfter
    total = sum(a.currentValue for a in after)
    for a in after: a.currentWeight = a.currentValue / total if total else 0
    before_risk = firewall.inspect_portfolio(assets,returns,limits)
    after_risk = firewall.inspect_portfolio(after,returns,limits,executed/original if original else 0)
    def impact(label, cls, old, new):
        return Impact(name=label,assetClass=cls,originalValue=old,stressedValue=new,absoluteLoss=old-new,
            percentageLoss=(old-new)/old if old else 0,originalWeight=old/original if original else 0,
            stressedWeight=new/total if total else 0)
    asset_impacts = [impact(a.name,a.assetClass,a.currentValue,b.currentValue) for a,b in zip(assets,after)]
    groups = defaultdict(lambda:[0.,0.])
    for a in asset_impacts:
        groups[a.assetClass][0] += a.originalValue; groups[a.assetClass][1] += a.stressedValue
    class_impacts = [impact(c,c,*v) for c,v in groups.items()]
    largest = max(class_impacts,key=lambda a:a.absoluteLoss)
    contributor = largest.name if largest.absoluteLoss > 0 else 'None'
    loss = original-total
    if withdrawal is not None:
        explanation = (f'Withdrawal of ₹{withdrawal/1e7:.2f} Cr is funded from cash then assets with liquidity scores ≥70. Remaining capital is ₹{total/1e7:.2f} Cr. The capital reduction is a withdrawal, not a market loss.' if fulfilled else f'Withdrawal cannot be funded: ₹{withdrawal/1e7:.2f} Cr requested versus ₹{available/1e7:.2f} Cr of eligible liquid capital. No assets were sold.')
    else:
        offsets = [a.name for a in class_impacts if a.absoluteLoss < 0]
        explanation = f'Under {name}, portfolio value {"falls" if loss >= 0 else "rises"} by {abs(loss/original) if original else 0:.2%}. '
        explanation += f'{contributor} is the largest contributor to loss. ' if contributor != 'None' else 'No asset class loses value. '
        if offsets: explanation += ', '.join(offsets) + (' provides a positive offset. ' if len(offsets) == 1 else ' provide positive offsets. ')
        explanation += 'Post-shock allocation risk uses changed weights under unchanged historical returns; it is not a forecast of crisis volatility.'
    prior = {c.controlName for c in before_risk.controls if c.status == 'BREACH'}
    breaches = [c for c in after_risk.controls if c.status == 'BREACH']
    return SimulationResult(stressedAssets=after, assumptions=applied, limits=limits, firewallChanges=firewall.transitions(before_risk, after_risk), scenarioName=name,originalPortfolioValue=original,stressedPortfolioValue=total,
        absoluteLoss=loss,percentageLoss=loss/original if original else 0,marketLoss=loss-executed,
        withdrawalAmount=executed,withdrawalFulfilled=fulfilled,assetImpacts=asset_impacts,assetClassImpacts=class_impacts,
        riskBefore=before_risk,riskAfter=after_risk,breachedControls=breaches,newBreaches=[c for c in breaches if c.controlName not in prior],
        liquidityImpact=LiquidityImpact(before=before_risk.metrics.liquidityScore,after=after_risk.metrics.liquidityScore,
            liquidCapitalBefore=available,liquidCapitalAfter=liquid_capital(after),sufficientLiquidCapital=fulfilled if withdrawal is not None else None),
        largestLossContributor=contributor,explanation=explanation)
