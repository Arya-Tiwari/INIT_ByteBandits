"""Shared policy definitions and breach transitions; no UI policy calculations."""
from .models import Control

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
        controls.append(Control(controlName=key, currentValue=current, limit=limit, status=status,
            severity='HIGH' if breach else 'MEDIUM' if warning else 'NONE', explanation=explanation))
    return controls


def inspect_portfolio(assets, returns, limits, turnover=0):
    # Local import avoids a cycle: the risk engine delegates policy checks to this module.
    from .risk_engine import evaluate
    return evaluate(assets, returns, limits, turnover)


def transitions(before, after):
    """Include all controls; existing includes persistent but improving breaches."""
    from .models import BreachTransition
    result = []
    for old, new in zip(before.controls, after.controls):
        was, now = old.status == 'BREACH', new.status == 'BREACH'
        minimum = next(p[3] for p in POLICIES if p[0] == new.controlName)
        worse = new.currentValue < old.currentValue - TOLERANCE if minimum else new.currentValue > old.currentValue + TOLERANCE
        state = ('NEW' if not was else 'WORSENED' if worse else 'EXISTING') if now else 'RESOLVED' if was else 'CLEAR'
        result.append(BreachTransition(controlName=new.controlName, change=state, before=old, after=new))
    return result
