"""Regression checks for the final audit's data-integrity and demo failures."""
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
import main
from historical_data import validate_returns
from market_simulation import _statistics, _breach_statistics, run_market_simulation
from models import RiskLimits, MarketSimulationRequest
from risk_engine import evaluate
from optimization_engine import optimize

client = TestClient(main.app)

@pytest.fixture(autouse=True)
def baseline():
    client.post('/api/reset')
    yield
    client.post('/api/reset')


def holding(**changes):
    return dict(name='Audit Holding', ticker='AUDIT', assetClass='Private Credit',
                currentValueCr=1, expectedReturnPercent=8, volatilityPercent=10,
                liquidityScore=80, **changes)


def test_dynamic_class_custom_shock_and_reset_history():
    columns = list(main.RETURNS)
    response = client.post('/api/portfolio/add-asset', json=holding())
    assert response.status_code == 200
    asset = response.json()['assets'][-1]
    result = client.post('/api/simulate/custom', json={'shocks': {'Private Credit': -20}})
    assert result.status_code == 200
    assert result.json()['stressedAssets'][-1]['currentValue'] == pytest.approx(asset['currentValue'] * .8)
    client.post('/api/reset')
    assert list(main.RETURNS) == columns


def test_duplicate_names_preserve_saved_holding_values():
    request = holding(); request['name'] = main.ASSETS[0].name
    assert client.post('/api/portfolio/add-asset', json=request).status_code == 200
    saved = client.post('/api/simulate', json={'scenarioId': 'market-crash'}).json()
    with patch('main.optimize', wraps=optimize) as spy:
        response = client.post(f"/api/simulate/{saved['simulationId']}/rebalance")
    assert response.status_code == 200
    originals = spy.call_args_list[0].args[0]
    assert [a.currentValue for a in originals] == [a['originalValue'] for a in saved['assetImpacts']]


def test_largest_loss_is_a_holding_not_a_class():
    result = client.post('/api/simulate', json={'scenarioId': 'market-crash'}).json()
    assert result['largestLossContributor'] == max(result['assetImpacts'], key=lambda impact: impact['absoluteLoss'])['name']


@pytest.mark.parametrize('empty', [False, True])
def test_zero_and_empty_portfolios_are_finite(empty):
    assets = [] if empty else [a.model_copy(update={'currentValue': 0, 'currentWeight': 0}) for a in main.ASSETS]
    report = evaluate(assets, main.RETURNS, RiskLimits())
    json.dumps(report.model_dump(), allow_nan=False)
    assert report.metrics.volatility == 0
    assert optimize(assets, main.RETURNS, RiskLimits()).status == 'INFEASIBLE'
    with pytest.raises(ValueError, match='positive capital'):
        run_market_simulation(assets, main.RETURNS, RiskLimits(), MarketSimulationRequest(mode='HISTORICAL'))


def test_one_asset_risk_and_concentration():
    asset = main.ASSETS[0].model_copy(update={'currentWeight': 1})
    report = evaluate([asset], main.RETURNS, RiskLimits())
    assert report.metrics.volatility == pytest.approx(main.RETURNS[asset.id].std() * np.sqrt(252))
    assert report.metrics.largestAssetExposure == 1
    assert any(c.controlName == 'maxSingleAssetWeight' and c.status == 'BREACH' for c in report.controls)


@pytest.mark.parametrize('problem', ['missing', 'nan', 'infinity', 'below_minus_one', 'short'])
def test_malformed_history(problem):
    frame = main.RETURNS.copy()
    if problem == 'missing': frame = frame.drop(columns=[main.ASSETS[0].id])
    elif problem == 'short': frame = frame.iloc[:1]
    else: frame.iloc[0, 0] = {'nan': np.nan, 'infinity': np.inf, 'below_minus_one': -1.01}[problem]
    with pytest.raises(ValueError): validate_returns(frame, [a.id for a in main.ASSETS])
    with pytest.raises(ValueError): evaluate(main.ASSETS, frame, RiskLimits())


def test_missing_history_fails_startup_instead_of_fabricating_data():
    code = "from unittest.mock import patch\nwith patch('pandas.read_csv', side_effect=FileNotFoundError('historical_returns.csv unavailable')):\n import main"
    result = subprocess.run([sys.executable, '-c', code], cwd=Path(main.__file__).parent, capture_output=True, text=True)
    assert result.returncode != 0
    assert 'historical_returns.csv unavailable' in result.stderr


def test_drawdown_matches_buy_and_hold_terminal_values():
    assets = [a.model_copy(update={'currentValue': 50, 'currentWeight': .5}) for a in main.ASSETS[:2]]
    paths = np.array([[[1., 0.], [-.5, 0.]]])
    history = pd.DataFrame({assets[0].id: [.01, -.01, .02], assets[1].id: [0., .01, -.01]})
    stats = _statistics(paths, assets, history, RiskLimits(), np.array([100., 100.]))
    assert stats.expectedReturn == pytest.approx(0)
    assert stats.maxDrawdown == pytest.approx(1 / 3)


def test_positive_history_has_no_empty_cvar_tail():
    asset = main.ASSETS[0].model_copy(update={'currentWeight': 1})
    history = pd.DataFrame({asset.id: [.01, .02, .03]})
    with np.errstate(all='raise'):
        probabilities, _, _ = _breach_statistics(np.array([[.1]]), [asset], history, RiskLimits(), np.array([100]))
    assert probabilities['maxCVaR'] == 0


def test_concurrent_adds_conserve_capital_and_ids():
    def add(index):
        body = holding(); body['ticker'] = f'AUDIT{index}'
        return client.post('/api/portfolio/add-asset', json=body)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(add, range(2)))
    assert all(r.status_code == 200 for r in responses)
    portfolio = client.get('/api/portfolio').json()
    assert portfolio['totalValue'] == 520_000_000
    assert len({a['id'] for a in portfolio['assets']}) == 11
    assert client.get('/api/risk').status_code == 200


def test_cache_invalidates_after_capital_and_limit_edits():
    before = client.get('/api/risk').json()
    assert client.post('/api/portfolio', json={'allocations': {'cash': 1}}).status_code == 200
    after = client.get('/api/risk').json()
    assert after != before and after['metrics']['cashWeight'] == 1
    limits = RiskLimits(maxSingleAssetWeight=1, maxAssetClassWeight=1).model_dump()
    assert client.post('/api/risk/limits', json=limits).status_code == 200
    assert next(c for c in client.get('/api/risk').json()['controls'] if c['controlName'] == 'maxSingleAssetWeight')['status'] != 'BREACH'


def test_partial_investment_with_explicit_cash_and_invalid_capital():
    response = client.post('/api/portfolio', json={'allocations': {'eq-large': .4, 'cash': .6}, 'totalValue': 100_000_000})
    assert response.status_code == 200
    assert sum(a['currentValue'] for a in response.json()['assets']) == 100_000_000
    assert client.get('/api/risk').json()['metrics']['cashWeight'] == .6
    for value in [0, -1, 'NaN', 'Infinity']:
        assert client.post('/api/portfolio', json={'totalValue': value}).status_code == 422
