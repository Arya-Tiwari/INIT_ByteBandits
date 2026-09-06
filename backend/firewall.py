"""Shared policy definitions and breach transitions; no UI policy calculations."""
from models import Control

# key, metric field, display label, minimum rather than maximum
POLICIES = (
    ('maxPortfolioVolatility', 'volatility', 'Annualized portfolio volatility', False),
    ('maxVaR', 'var95', 'One-day 95% VaR', False),
    ('maxCVaR', 'cvar95', 'One-day 95% CVaR', False),
    ('maxSingleAssetWeight', 'largestAssetExposure', 'Largest asset exposure', False),
    ('maxAssetClassWeight', 'largestAssetClassExposure', 'Largest asset-class exposure', False),
    ('minimumLiquidityScore', 'liquidityScore', 'Portfolio liquidity score', True),
    ('minimumCashWeight', 'cashWeight', 'Cash exposure', True),
    ('maximumTurnover', 'turnover', 'Cumulative one-way turnover', False),
)
TOLERANCE = 1e-8


def policy_margins(metrics, limits):
    """Nonnegative = compliant, normalized to consistent optimizer scales."""
    return [(getattr(metrics, field) - getattr(limits, key) if minimum else
             getattr(limits, key) - getattr(metrics, field)) / (100 if field == 'liquidityScore' else 1)
            for key, field, _, minimum in POLICIES]


REMEDIATIONS = {
    'maxPortfolioVolatility': 'Reallocate capital from high-volatility equities to government bonds or treasury cash to reduce portfolio variance.',
    'maxVaR': 'Trim overweight equity holdings (especially mid-cap positions) and increase defensive cash/bond reserves.',
    'maxCVaR': 'Run 1-click Portfolio Optimization to trim tail-risk concentrations, or switch to Growth risk appetite.',
    'maxSingleAssetWeight': 'Trim single asset weight below policy limit and distribute proceeds into under-weighted holdings.',
    'maxAssetClassWeight': 'Reduce overall asset class concentration by rebalancing into complementary asset classes.',
    'minimumLiquidityScore': 'Liquidate illiquid holdings (<70 liquidity score) or route incoming capital into Treasury Cash to satisfy liquidity floor.',
    'minimumCashWeight': 'Sell liquid holdings or execute a capital route to restore cash reserve floor.',
    'maximumTurnover': 'Hold positions steady or increase maximum turnover budget in Risk Firewall limits to allow larger rebalance trades.',
}


def check(metrics, limits):
    controls = []
    for key, field, label, minimum in POLICIES:
        current, limit = getattr(metrics, field), getattr(limits, key)
        if field == 'largestAssetExposure': label = f'{metrics.largestAssetName} exposure'
        if field == 'largestAssetClassExposure': label = f'{metrics.largestAssetClass} exposure'
        gap = current - limit if minimum else limit - current
        breach = gap < -TOLERANCE
        warning = gap <= limit * .1 + TOLERANCE
        status = 'BREACH' if breach else 'WARNING' if warning else 'PASS'
        fmt = (lambda x: f'{x:.1f}/100') if field == 'liquidityScore' else (lambda x: f'{x:.2%}')
        relationship = ('below' if minimum else 'above') if breach else 'within'
        explanation = f'{label} is {fmt(current)}, {relationship} the configured {"minimum" if minimum else "maximum"} of {fmt(limit)}.'
        if status == 'WARNING': explanation += ' This is within 10% of the limit.'
        remediation = None
        if breach or warning:
            if field == 'largestAssetExposure':
                remediation = f'Trim {metrics.largestAssetName} weight below {limit:.1%} and reallocate to under-weighted holdings.'
            elif field == 'largestAssetClassExposure':
                remediation = f'Reduce overall {metrics.largestAssetClass} exposure below {limit:.1%} by rebalancing into complementary asset classes.'
            else:
                remediation = REMEDIATIONS.get(key, 'Run optimization to rebalance portfolio and satisfy policy boundary.')
        controls.append(Control(controlName=key, currentValue=current, limit=limit, status=status,
            severity='HIGH' if breach else 'MEDIUM' if warning else 'NONE', explanation=explanation, remediation=remediation))
    return controls


def inspect_portfolio(assets, returns, limits, turnover=0):
    # Local import avoids a cycle: the risk engine delegates policy checks to this module.
    from risk_engine import evaluate
    return evaluate(assets, returns, limits, turnover)


def transitions(before, after):
    """Include all controls; existing includes persistent but improving breaches."""
    from models import BreachTransition
    result = []
    for old, new in zip(before.controls, after.controls):
        was, now = old.status == 'BREACH', new.status == 'BREACH'
        minimum = next(p[3] for p in POLICIES if p[0] == new.controlName)
        worse = new.currentValue < old.currentValue - TOLERANCE if minimum else new.currentValue > old.currentValue + TOLERANCE
        state = ('NEW' if not was else 'WORSENED' if worse else 'EXISTING') if now else 'RESOLVED' if was else 'CLEAR'
        result.append(BreachTransition(controlName=new.controlName, change=state, before=old, after=new))
    return result
