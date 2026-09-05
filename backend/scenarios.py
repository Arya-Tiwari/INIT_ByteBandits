"""One editable source for scenario execution and the pre-run assumption sheet.

Shocks are percentage points. Rate duration is a modified-duration approximation.
"""
from .models import Scenario, ShockAssumption

DEFINITIONS = {
    'market-crash': dict(name='Market Crash', description='A sharp equity sell-off with defensive offsets.',
        shocks={'Equity':-25,'International Equity':-22,'REIT':-18,'Corporate Bonds':-5,'Government Bonds':3,'Gold':8,'Cash':0}),
    'tech-selloff': dict(name='Tech Selloff', description='Growth-sensitive equity holdings fall while cash and high-quality bonds hold value.',
        shocks={'Equity':-8,'International Equity':-14,'REIT':-5,'Corporate Bonds':0,'Government Bonds':2,'Gold':1,'Cash':0},
        assetShocks={'eq-mid':-18}),
    'interest-rate': dict(name='Interest Rate Shock', description='A parallel 200 bp rise in rates.', rateChange=.02,
        shocks={'Equity':-8,'International Equity':-6,'REIT':-12,'Gold':-4,'Cash':0}),
    'liquidity-crisis': dict(name='Liquidity Crisis', description='Non-cash liquidity falls 40%; less-liquid assets lose more.', liquidityMultiplier=.6,
        baseLoss=.03, illiquidityLoss=.22, shocks={}),
    'inflation-shock': dict(name='Inflation Shock', description='Higher inflation pressures bonds and property while gold provides a partial offset.',
        shocks={'Equity':-4,'International Equity':-3,'REIT':-5,'Corporate Bonds':-7,'Government Bonds':-9,'Gold':7,'Cash':0}),
    'global-recession': dict(name='Global Recession', description='Risky assets decline; government bonds and gold gain.',
        shocks={'Equity':-15,'International Equity':-17,'REIT':-12,'Corporate Bonds':-4,'Government Bonds':4,'Gold':5,'Cash':0}),
    'equity-rally': dict(name='Equity Rally', description='Domestic and global equities rise; defensive assets lag.',
        shocks={'Equity':18,'International Equity':14,'REIT':8,'Corporate Bonds':2,'Government Bonds':-2,'Gold':-4,'Cash':0}),
    'broad-market-stress': dict(name='Broad Market Stress', description='Equities, bonds, property and gold decline together; cash is flat.',
        shocks={'Equity':-18,'International Equity':-16,'REIT':-20,'Corporate Bonds':-9,'Government Bonds':-6,'Gold':-7,'Cash':0}),
}


def assumptions(assets, scenario_id=None, shocks=None, asset_shocks=None):
    definition = DEFINITIONS[scenario_id] if scenario_id else {}
    defaults = definition.get('shocks', shocks or {})
    overrides = {**definition.get('assetShocks', {}), **(asset_shocks or {})}
    unknown = set(overrides) - {a.id for a in assets}
    if unknown: raise ValueError('Unknown holding IDs: ' + ', '.join(sorted(unknown)))
    result = []
    for a in assets:
        shock = overrides.get(a.id, defaults.get(a.assetClass, 0))
        liquidity = a.liquidityScore
        basis = 'Asset override' if a.id in overrides else 'Class default'
        if 'rateChange' in definition and a.assetClass in ('Government Bonds','Corporate Bonds'):
            shock = max(-100, -a.duration * definition['rateChange'] * 100)
            basis = f'Duration {a.duration:g} × +{definition["rateChange"]:.1%} rates'
        if 'liquidityMultiplier' in definition and a.assetClass != 'Cash':
            shock = -100*(definition['baseLoss'] + definition['illiquidityLoss']*(1-a.liquidityScore/100))
            liquidity *= definition['liquidityMultiplier']
            basis = 'Liquidity-dependent loss; non-cash liquidity × 0.60'
        result.append(ShockAssumption(assetId=a.id,name=a.name,assetClass=a.assetClass,
            shockPercent=shock,liquidityBefore=a.liquidityScore,liquidityAfter=liquidity,basis=basis))
    return result


def catalog(assets):
    return [Scenario(id=k,name=d['name'],description=d['description'],assumptions=assumptions(assets,k))
        for k,d in DEFINITIONS.items()] + [
        Scenario(id='withdrawal',name='Capital Withdrawal',description='Cash first, then holdings with liquidity ≥70. All-or-nothing funding.'),
        Scenario(id='custom',name='Custom Scenario',description='Class defaults with optional per-holding overrides.')]
