from pathlib import Path
import json
from threading import Lock
import pandas as pd
from fastapi import FastAPI, HTTPException
from uuid import uuid4
from collections import OrderedDict
from .models import Asset, Portfolio, PortfolioAllocationRequest, RiskLimits, RiskReport, Scenario, ScenarioRequest, CustomRequest, WithdrawalRequest, SimulationResult, RebalanceResult, RouteCapitalRequest, RouteCapitalResponse
from .risk_engine import evaluate
from .simulation_engine import simulate
from .scenarios import catalog
from .optimization_engine import optimize

DATA = Path(__file__).parent / 'data'
ASSETS = [Asset.model_validate(a) for a in json.loads((DATA/'portfolio.json').read_text())]
_assets = [asset.model_copy(deep=True) for asset in ASSETS]
RETURNS = pd.read_csv(DATA/'historical_returns.csv',index_col='date')
app = FastAPI(title='AEGIS',version='1.0.0')
_limits = RiskLimits()
_lock = Lock()
_simulations = OrderedDict()

APPETITES = {
    'CONSERVATIVE': RiskLimits(maxPortfolioVolatility=0.12, maxVaR=0.012, maxCVaR=0.018, maxSingleAssetWeight=0.20, maxAssetClassWeight=0.40, minimumLiquidityScore=75, minimumCashWeight=0.08, maximumTurnover=0.15, riskAppetite='CONSERVATIVE'),
    'BALANCED': RiskLimits(maxPortfolioVolatility=0.16, maxVaR=0.018, maxCVaR=0.025, maxSingleAssetWeight=0.25, maxAssetClassWeight=0.55, minimumLiquidityScore=70, minimumCashWeight=0.05, maximumTurnover=0.20, riskAppetite='BALANCED'),
    'GROWTH': RiskLimits(maxPortfolioVolatility=0.22, maxVaR=0.030, maxCVaR=0.040, maxSingleAssetWeight=0.35, maxAssetClassWeight=0.65, minimumLiquidityScore=60, minimumCashWeight=0.03, maximumTurnover=0.30, riskAppetite='GROWTH'),
}

def limits_snapshot():
    with _lock: return _limits.model_copy(deep=True)

def assets_snapshot():
    with _lock: return [asset.model_copy(deep=True) for asset in _assets]

@app.get('/api/portfolio',response_model=Portfolio)
def portfolio():
    assets = assets_snapshot()
    return Portfolio(assets=assets,totalValue=sum(a.currentValue for a in assets),historyObservations=len(RETURNS))

@app.post('/api/portfolio',response_model=Portfolio)
def update_portfolio(request: PortfolioAllocationRequest):
    global _assets
    current = assets_snapshot()
    total = request.totalValue if request.totalValue is not None else sum(asset.currentValue for asset in current)
    allocations = request.allocations if request.allocations is not None else {asset.id: asset.currentWeight for asset in current}
    expected = {asset.id for asset in current}
    received = set(allocations)
    if received != expected:
        missing, unknown = sorted(expected-received), sorted(received-expected)
        detail = []
        if missing: detail.append('Missing holding IDs: ' + ', '.join(missing))
        if unknown: detail.append('Unknown holding IDs: ' + ', '.join(unknown))
        raise HTTPException(status_code=422, detail='; '.join(detail))
    updated = [asset.model_copy(update={
        'currentWeight': allocations[asset.id],
        'currentValue': total * allocations[asset.id],
    }) for asset in current]
    with _lock: _assets = [asset.model_copy(deep=True) for asset in updated]
    return Portfolio(assets=updated,totalValue=total,historyObservations=len(RETURNS))

@app.post('/api/portfolio/route-capital', response_model=RouteCapitalResponse)
def route_capital(request: RouteCapitalRequest):
    global _assets
    current = assets_snapshot()
    total = sum(a.currentValue for a in current)
    limits = limits_snapshot()
    report = evaluate(current, RETURNS, limits)
    min_liq = limits.minimumLiquidityScore
    needed_liq = max(0.0, (min_liq - report.metrics.liquidityScore) / 100.0 * total)
    routed = min(request.incomingCapital, needed_liq)
    remaining = request.incomingCapital - routed

    updated = []
    new_total = total + request.incomingCapital
    for a in current:
        add_val = request.incomingCapital if a.assetClass == 'Cash' else 0.0
        new_val = a.currentValue + add_val
        updated.append(a.model_copy(update={
            'currentValue': new_val,
            'currentWeight': new_val / new_total if new_total > 0 else 0
        }))
    with _lock:
        _assets = [a.model_copy(deep=True) for a in updated]
    return RouteCapitalResponse(routedToLiquidity=routed, remainingCapital=remaining, updatedAssets=updated, totalValue=new_total)

@app.get('/api/risk',response_model=RiskReport)
def risk(): return evaluate(assets_snapshot(),RETURNS,limits_snapshot())

@app.get('/api/risk/limits',response_model=RiskLimits)
def get_limits(): return limits_snapshot()

@app.get('/api/risk/appetites', response_model=dict[str, RiskLimits])
def get_appetites(): return APPETITES

@app.post('/api/risk/limits',response_model=RiskLimits)
def update_limits(value: RiskLimits):
    global _limits
    with _lock: _limits = value.model_copy(deep=True)
    return value

@app.get('/api/simulations',response_model=list[Scenario])
def scenarios():
    return catalog(assets_snapshot())

@app.post('/api/optimize',response_model=RebalanceResult)
def optimize_portfolio():
    """Return a funded proposal for the current portfolio; never execute it."""
    assets = assets_snapshot()
    total = sum(a.currentValue for a in assets)
    return optimize(assets, RETURNS, limits_snapshot(), original_capital=total)

@app.post('/api/simulate',response_model=SimulationResult)
def predefined(request: ScenarioRequest):
    return remember(simulate(assets_snapshot(),RETURNS,limits_snapshot(),scenario_id=request.scenarioId))

@app.post('/api/simulate/custom',response_model=SimulationResult)
def custom(request: CustomRequest):
    try:
        return remember(simulate(assets_snapshot(),RETURNS,limits_snapshot(),name=request.name,shocks=request.shocks,asset_shocks=request.assetShocks))
    except ValueError as exc:
        raise HTTPException(status_code=422,detail=str(exc))

@app.post('/api/simulate/withdrawal',response_model=SimulationResult)
def withdrawal(request: WithdrawalRequest):
    assets = assets_snapshot()
    amount = request.withdrawalAmount if request.withdrawalAmount is not None else sum(a.currentValue for a in assets)*request.withdrawalPercent/100
    return remember(simulate(assets,RETURNS,limits_snapshot(),withdrawal=amount))


def remember(result):
    result.simulationId = uuid4().hex
    with _lock:
        _simulations[result.simulationId] = result.model_copy(deep=True)
        while len(_simulations) > 128: _simulations.popitem(last=False)
    return result

@app.post('/api/simulate/{simulation_id}/rebalance',response_model=RebalanceResult)
def rebalance(simulation_id: str):
    with _lock:
        saved = _simulations.get(simulation_id)
        if saved is None: raise HTTPException(status_code=404, detail='Simulation expired. Run the scenario again.')
        saved = saved.model_copy(deep=True)
        current_limits = _limits.model_copy(deep=True)
    if current_limits != saved.limits:
        raise HTTPException(status_code=409,detail='Risk limits changed. Run the scenario again before requesting a rebalance.')
    return optimize(saved.stressedAssets, RETURNS, current_limits,
        original_capital=saved.originalPortfolioValue, consumed_turnover=saved.riskAfter.metrics.turnover)
