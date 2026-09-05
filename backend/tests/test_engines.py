import json
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from backend.main import app, ASSETS, RETURNS
from backend.models import RiskLimits
from backend.risk_engine import evaluate
from backend.simulation_engine import simulate

client = TestClient(app)

@pytest.fixture(autouse=True)
def reset_limits():
    client.post('/api/risk/limits',json=RiskLimits().model_dump())
    defaults = {asset.id: asset.currentWeight for asset in ASSETS}
    client.post('/api/portfolio',json={'allocations': defaults})
    yield
    client.post('/api/risk/limits',json=RiskLimits().model_dump())
    client.post('/api/portfolio',json={'allocations': defaults})

@pytest.mark.parametrize('path',['/api/portfolio','/api/risk','/api/risk/limits','/api/simulations','/openapi.json'])
def test_get_endpoints(path):
    assert client.get(path).status_code == 200

def test_current_portfolio_optimization_is_funded_and_read_only():
    before = [asset.model_copy(deep=True) for asset in ASSETS]
    response = client.post('/api/optimize').json()
    assert response['status'] == 'FEASIBLE'
    assert response['externalCapital'] == 0
    buys = sum(t['amount'] for t in response['trades'] if t['action'] == 'BUY')
    sells = sum(t['amount'] for t in response['trades'] if t['action'] == 'SELL')
    assert buys == pytest.approx(sells, abs=.1)
    assert ASSETS == before

def test_portfolio_allocations_can_be_updated_and_recalculated():
    allocations = {asset.id: asset.currentWeight for asset in ASSETS}
    allocations['eq-large'] -= .05
    allocations['cash'] += .05
    response = client.post('/api/portfolio', json={'allocations': allocations})
    assert response.status_code == 200, response.text
    data = response.json()
    assert sum(asset['currentWeight'] for asset in data['assets']) == pytest.approx(1)
    assert sum(asset['currentValue'] for asset in data['assets']) == pytest.approx(data['totalValue'])
    assert client.get('/api/risk').json()['metrics']['cashWeight'] == pytest.approx(.09)

def test_invalid_portfolio_allocations_are_rejected():
    assert client.post('/api/portfolio', json={'allocations': {'eq-large': .5}}).status_code == 422
    invalid = {asset.id: asset.currentWeight for asset in ASSETS}
    invalid['unknown'] = 0
    assert client.post('/api/portfolio', json={'allocations': invalid}).status_code == 422

def test_data_and_covariance():
    assert sum(a.currentWeight for a in ASSETS) == pytest.approx(1)
    assert len(RETURNS) == 756
    report = evaluate(ASSETS,RETURNS,RiskLimits())
    w = np.array([a.currentWeight for a in ASSETS])
    expected = np.std(RETURNS.to_numpy() @ w,ddof=1)*np.sqrt(252)
    assert report.metrics.volatility == pytest.approx(expected)
    assert report.metrics.cvar95 >= report.metrics.var95 >= 0
    assert report.metrics.sharpeRatio == pytest.approx((report.metrics.expectedReturn-.04)/report.metrics.volatility)
    assert report.riskScore == pytest.approx(sum(c.contribution for c in report.components),abs=.005)

def test_known_losses_and_drawdown():
    a = ASSETS[0].model_copy(update={'currentValue':100,'currentWeight':1})
    # Keep two assets to exercise a genuine matrix, with the second at zero weight.
    b = ASSETS[1].model_copy(update={'currentValue':0,'currentWeight':0})
    history = pd.DataFrame({a.id:[.1,-.2,.1,-.05],b.id:[0,0,0,0]})
    m = evaluate([a,b],history,RiskLimits()).metrics
    assert m.var95 == pytest.approx(.1775)
    assert m.cvar95 == pytest.approx(.2)
    assert m.maxDrawdown == pytest.approx(.2)

@pytest.mark.parametrize('scenario',['market-crash','interest-rate','liquidity-crisis','global-recession'])
def test_scenarios_and_immutability(scenario):
    baseline = client.get('/api/portfolio').json()
    history = RETURNS.copy(deep=True)
    r = client.post('/api/simulate',json={'scenarioId':scenario})
    assert r.status_code == 200,r.text
    data = r.json()
    json.dumps(data,allow_nan=False)
    assert sum(a['stressedWeight'] for a in data['assetImpacts']) == pytest.approx(1)
    assert data['absoluteLoss'] == pytest.approx(sum(a['absoluteLoss'] for a in data['assetImpacts']))
    assert client.get('/api/portfolio').json() == baseline
    pd.testing.assert_frame_equal(RETURNS,history)
    if scenario == 'market-crash':
        assert data['percentageLoss'] == pytest.approx(.165)
    if scenario == 'interest-rate':
        bond = next(a for a in data['assetImpacts'] if a['assetClass']=='Government Bonds')
        assert bond['percentageLoss'] == pytest.approx(.144)
    if scenario == 'liquidity-crisis':
        assert data['liquidityImpact']['after'] < data['liquidityImpact']['before']
        assert 'minimumLiquidityScore' in [c['controlName'] for c in data['breachedControls']]

def test_custom_applies_to_all_class_assets():
    data = client.post('/api/simulate/custom',json={'shocks':{'Equity':-20,'Gold':10}}).json()
    for a in data['assetImpacts']:
        assert a['percentageLoss'] == pytest.approx(.2 if a['assetClass']=='Equity' else -.1 if a['assetClass']=='Gold' else 0)

@pytest.mark.parametrize('body',[{'withdrawalPercent':10},{'withdrawalAmount':50_000_000}])
def test_withdrawal(body):
    before=client.get('/api/portfolio').json()
    r=client.post('/api/simulate/withdrawal',json=body)
    assert r.status_code==200,r.text
    data=r.json()
    assert data['withdrawalFulfilled']
    assert data['stressedPortfolioValue']==pytest.approx(450_000_000)
    assert data['marketLoss']==pytest.approx(0)
    assert next(a for a in data['assetImpacts'] if a['assetClass']=='Cash')['stressedValue']==0
    assert data['riskAfter']['metrics']['turnover']==pytest.approx(.1)
    assert client.get('/api/portfolio').json()==before

def test_insufficient_liquidity():
    data=client.post('/api/simulate/withdrawal',json={'withdrawalPercent':100}).json()
    assert not data['withdrawalFulfilled']
    assert data['withdrawalAmount']==0
    assert data['originalPortfolioValue']==data['stressedPortfolioValue']

def test_total_wipeout_is_finite():
    data=client.post('/api/simulate/custom',json={'shocks':{a.assetClass:-100 for a in ASSETS}}).json()
    json.dumps(data,allow_nan=False)
    assert data['stressedPortfolioValue']==0
    assert sum(a['stressedWeight'] for a in data['assetImpacts'])==0
    assert data['riskAfter']['metrics']['volatility']==0

@pytest.mark.parametrize('path,body',[
    ('/api/simulate',{'scenarioId':'invalid'}),
    ('/api/simulate/custom',{'shocks':{'Unknown':10}}),
    ('/api/simulate/custom',{'shocks':{'Equity':-101}}),
    ('/api/simulate/custom',{'shocks':{'Equity':'NaN'}}),
    ('/api/simulate/custom',{'shocks':{}}),
    ('/api/simulate/withdrawal',{}),
    ('/api/simulate/withdrawal',{'withdrawalPercent':0}),
    ('/api/simulate/withdrawal',{'withdrawalPercent':101}),
    ('/api/simulate/withdrawal',{'withdrawalPercent':10,'withdrawalAmount':5}),
    ('/api/risk/limits',{'maxVaR':0}),
])
def test_validation(path,body):
    assert client.post(path,json=body).status_code==422

def test_limits_change_controls():
    limits=RiskLimits().model_dump();limits['maxSingleAssetWeight']=.4
    assert client.post('/api/risk/limits',json=limits).json()==limits
    control=next(c for c in client.get('/api/risk').json()['controls'] if c['controlName']=='maxSingleAssetWeight')
    assert control['status']=='PASS'
    assert '40.00%' in control['explanation']
