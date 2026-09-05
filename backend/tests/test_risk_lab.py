import json
from unittest.mock import patch
import numpy as np
import pytest
from fastapi.testclient import TestClient
from backend import firewall
from backend.main import app, ASSETS, RETURNS
from backend.models import RiskLimits
from backend.scenarios import catalog
from backend.simulation_engine import simulate
from backend.optimization_engine import optimize

client=TestClient(app)
@pytest.fixture(autouse=True)
def reset():
    client.post('/api/risk/limits',json=RiskLimits().model_dump())
    yield
    client.post('/api/risk/limits',json=RiskLimits().model_dump())

def custom(body):
    response=client.post('/api/simulate/custom',json=body)
    assert response.status_code==200,response.text
    return response.json()

def test_zero_shocks_and_explicit_zero_override():
    zero=custom({'shocks':{'Equity':0}})
    assert zero['absoluteLoss']==0
    assert zero['riskBefore']==zero['riskAfter']
    data=custom({'shocks':{'Equity':-20},'assetShocks':{ASSETS[0].id:0}})
    assert data['stressedAssets'][0]['currentValue']==ASSETS[0].currentValue
    assert data['stressedAssets'][1]['currentValue']==pytest.approx(ASSETS[1].currentValue*.8)
    assert data['assumptions'][0]['basis']=='Asset override'

def test_mixed_overrides_and_immutability():
    baseline=client.get('/api/portfolio').json()
    data=custom({'shocks':{'Equity':-20},'assetShocks':{ASSETS[0].id:10,ASSETS[1].id:-30}})
    assert data['stressedAssets'][0]['currentValue']==pytest.approx(ASSETS[0].currentValue*1.1)
    assert data['stressedAssets'][1]['currentValue']==pytest.approx(ASSETS[1].currentValue*.7)
    assert data['stressedAssets'][2]['currentValue']==pytest.approx(ASSETS[2].currentValue*.8)
    assert sum(a['currentWeight'] for a in data['stressedAssets'])==pytest.approx(1)
    assert sum(a['currentValue'] for a in data['stressedAssets'])==pytest.approx(data['stressedPortfolioValue'])
    assert client.get('/api/portfolio').json()==baseline

def test_positive_gains_asset_only_and_above_100():
    data=custom({'assetShocks':{ASSETS[0].id:150}})
    assert data['marketLoss']==pytest.approx(-ASSETS[0].currentValue*1.5)
    assert 'rises' in data['explanation']

@pytest.mark.parametrize('value',[-100.01,10001,'NaN','Infinity',None,'bad'])
def test_invalid_overrides(value):
    assert client.post('/api/simulate/custom',json={'assetShocks':{ASSETS[0].id:value}}).status_code==422

def test_unknown_holding():
    assert client.post('/api/simulate/custom',json={'assetShocks':{'bogus':1}}).status_code==422

@pytest.mark.parametrize('scenario',['equity-rally','broad-market-stress','tech-selloff','inflation-shock','interest-rate','liquidity-crisis'])
def test_preview_is_execution(scenario):
    preview=next(s for s in catalog(ASSETS) if s.id==scenario)
    result=client.post('/api/simulate',json={'scenarioId':scenario}).json()
    assert result['assumptions']==[a.model_dump() for a in preview.assumptions]
    for old,new,assumption in zip(ASSETS,result['stressedAssets'],preview.assumptions):
        assert new['currentValue']==pytest.approx(old.currentValue*(1+assumption.shockPercent/100))
        assert new['liquidityScore']==assumption.liquidityAfter
    if scenario=='equity-rally': assert result['marketLoss']<0
    if scenario=='broad-market-stress': assert result['marketLoss']>0

def test_actual_stressed_portfolio_reaches_firewall():
    with patch('backend.firewall.inspect_portfolio',wraps=firewall.inspect_portfolio) as spy:
        result=simulate(ASSETS,RETURNS,RiskLimits(),scenario_id='liquidity-crisis')
        after=spy.call_args_list[1].args[0]
        assert [a.model_dump() for a in after]==[a.model_dump() for a in result.stressedAssets]
        assert after[0].liquidityScore==pytest.approx(ASSETS[0].liquidityScore*.6)
        assert after[0].currentWeight!=ASSETS[0].currentWeight
        assert any(c.change=='NEW' and c.controlName=='minimumLiquidityScore' for c in result.firewallChanges)

def test_transition_states():
    baseline=firewall.inspect_portfolio(ASSETS,RETURNS,RiskLimits())
    worsened=baseline.model_copy(deep=True)
    worsened.controls[3].currentValue+=.1
    worsened.controls[4].status='PASS'
    worsened.controls[0].status='BREACH'
    worsened.controls[0].currentValue=.3
    changes={x.controlName:x.change for x in firewall.transitions(baseline,worsened)}
    assert changes['maxSingleAssetWeight']=='WORSENED'
    assert changes['maxAssetClassWeight']=='RESOLVED'
    assert changes['maxPortfolioVolatility']=='NEW'
    assert changes['minimumCashWeight']=='EXISTING'

def test_full_withdrawal_when_all_capital_liquid():
    assets=[a.model_copy(update={'liquidityScore':100}) for a in ASSETS]
    before=[a.model_dump() for a in assets]
    total=sum(a.currentValue for a in assets)
    result=simulate(assets,RETURNS,RiskLimits(),withdrawal=total)
    assert result.withdrawalFulfilled and result.stressedPortfolioValue==0
    assert result.marketLoss==0
    assert sum(a.currentWeight for a in result.stressedAssets)==0
    assert result.riskAfter.metrics.volatility==0
    assert [a.model_dump() for a in assets]==before
    json.dumps(result.model_dump(),allow_nan=False)
    assert optimize(result.stressedAssets,RETURNS,RiskLimits(),total,1).status=='INFEASIBLE'

def test_ineligible_capital_is_not_sold():
    result=simulate(ASSETS,RETURNS,RiskLimits(),withdrawal=sum(a.currentValue for a in ASSETS))
    assert not result.withdrawalFulfilled
    assert result.withdrawalAmount==0
    assert [a.currentValue for a in result.stressedAssets]==[a.currentValue for a in ASSETS]

def test_optimizer_receives_saved_stressed_holdings_and_limits():
    response=client.post('/api/simulate',json={'scenarioId':'market-crash'}).json()
    with patch('backend.main.optimize',wraps=optimize) as spy:
        result=client.post('/api/simulate/'+response['simulationId']+'/rebalance',json={})
        assert result.status_code==200,result.text
        assert [a.model_dump() for a in spy.call_args.args[0]]==response['stressedAssets']
        assert spy.call_args.args[2].model_dump()==response['limits']
        assert spy.call_args.kwargs['original_capital']==response['originalPortfolioValue']
    data=result.json()
    assert data['status']=='FEASIBLE',data
    assert data['externalCapital']==0
    assert sum(a['currentValue'] for a in data['assets'])==pytest.approx(response['stressedPortfolioValue'])
    assert sum(a['currentWeight'] for a in data['assets'])==pytest.approx(1)
    assert sum(t['amount'] for t in data['trades'] if t['action']=='BUY')==pytest.approx(sum(t['amount'] for t in data['trades'] if t['action']=='SELL'),abs=.1)
    assert not any(c['status']=='BREACH' for c in data['risk']['controls'])
    assert data['cumulativeTurnover']<=response['limits']['maximumTurnover']+1e-8
    for old,new in zip(response['stressedAssets'],data['assets']):
        if old['liquidityScore']<70: assert new['currentValue']==pytest.approx(old['currentValue'])
    assert client.get('/api/portfolio').json()['totalValue']==500_000_000

@pytest.mark.parametrize('scenario',['liquidity-crisis'])
def test_infeasible_rebalance_explains_constraints(scenario):
    s=simulate(ASSETS,RETURNS,RiskLimits(),scenario_id=scenario)
    result=optimize(s.stressedAssets,RETURNS,s.limits,s.originalPortfolioValue)
    assert result.status=='INFEASIBLE'
    assert result.conflicts and not result.trades and result.risk is None
    assert 'Locked holdings' in ' '.join(result.conflicts)

def test_turnover_conflict_and_stale_limits():
    limits=RiskLimits(maximumTurnover=.0001)
    s=simulate(ASSETS,RETURNS,limits,scenario_id='equity-rally')
    result=optimize(s.stressedAssets,RETURNS,limits,s.originalPortfolioValue)
    assert result.status=='INFEASIBLE'
    assert 'Turnover' in ' '.join(result.conflicts)
    saved=client.post('/api/simulate',json={'scenarioId':'market-crash'}).json()
    client.post('/api/risk/limits',json=limits.model_dump())
    assert client.post('/api/simulate/'+saved['simulationId']+'/rebalance').status_code==409
    assert client.post('/api/simulate/unknown/rebalance').status_code==404

def test_withdrawal_turnover_is_carried_forward():
    s=simulate(ASSETS,RETURNS,RiskLimits(),withdrawal=50_000_000)
    result=optimize(s.stressedAssets,RETURNS,s.limits,s.originalPortfolioValue,s.riskAfter.metrics.turnover)
    assert result.status=='FEASIBLE', result.model_dump()
    assert result.cumulativeTurnover==pytest.approx(.1+result.turnover*.9)
    assert result.cumulativeTurnover<=.2+1e-8
    assert next(a for a in result.assets if a.assetClass=='Cash').currentValue>0


def test_unverified_nonlinear_solution_is_not_success():
    limits=RiskLimits(maxPortfolioVolatility=.000001)
    s=simulate(ASSETS,RETURNS,limits,scenario_id='market-crash')
    result=optimize(s.stressedAssets,RETURNS,limits,s.originalPortfolioValue)
    assert result.status=='NOT_FOUND'
    assert result.conflicts and not result.trades and result.risk is None
    assert 'not a proof' in result.explanation

@pytest.mark.parametrize('scenario', ['market-crash', 'equity-rally'])
def test_minimum_trades_are_removed_from_holdings_and_rechecked(scenario):
    s = simulate(ASSETS, RETURNS, RiskLimits(), scenario_id=scenario)
    baseline = [a.model_dump() for a in s.stressedAssets]
    proposal = optimize(s.stressedAssets, RETURNS, s.limits, s.originalPortfolioValue)
    assert proposal.status == 'FEASIBLE'
    assert proposal.minimumTradeAmount == 1000
    assert 'risk-minimizing' in proposal.objective
    assert 'full turnover budget' in proposal.objective
    for old, new, trade in zip(s.stressedAssets, proposal.assets, proposal.trades):
        actual = new.currentValue - old.currentValue
        assert abs(actual) == pytest.approx(trade.amount, abs=.01)
        if trade.action == 'HOLD':
            assert actual == pytest.approx(0, abs=.01)
        else:
            assert trade.amount >= proposal.minimumTradeAmount - .01
    assert sum(a.currentValue for a in proposal.assets) == pytest.approx(s.stressedPortfolioValue, abs=.01)
    buys = sum(t.amount for t in proposal.trades if t.action == 'BUY')
    sells = sum(t.amount for t in proposal.trades if t.action == 'SELL')
    assert buys == pytest.approx(sells, abs=.01)
    checked = firewall.inspect_portfolio(proposal.assets, RETURNS, s.limits, proposal.cumulativeTurnover)
    assert checked == proposal.risk
    assert not any(c.status == 'BREACH' for c in checked.controls)
    assert [a.model_dump() for a in s.stressedAssets] == baseline
    if scenario == 'market-crash':
        for ticker in ['gold', 'intl']:
            assert next(t for t in proposal.trades if t.assetId == ticker).action == 'HOLD'


def test_threshold_cannot_turn_an_unfunded_repair_into_success():
    s = simulate(ASSETS, RETURNS, RiskLimits(), scenario_id='market-crash')
    with patch('backend.optimization_engine.MINIMUM_TRADE_AMOUNT', 1_000_000_000):
        proposal = optimize(s.stressedAssets, RETURNS, s.limits, s.originalPortfolioValue)
    assert proposal.status == 'NOT_FOUND'
    assert proposal.trades == [] and proposal.risk is None
    assert 'minimum-trade threshold' in proposal.explanation
