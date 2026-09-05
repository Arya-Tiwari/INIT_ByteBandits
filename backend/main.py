from pathlib import Path
import json
from threading import Lock
import pandas as pd
from fastapi import FastAPI, HTTPException
from uuid import uuid4
from collections import OrderedDict
from .models import Asset, Portfolio, RiskLimits, RiskReport, Scenario, ScenarioRequest, CustomRequest, WithdrawalRequest, SimulationResult, RebalanceResult
from .risk_engine import evaluate
from .simulation_engine import simulate
from .scenarios import catalog
from .optimization_engine import optimize

DATA = Path(__file__).parent / 'data'
ASSETS = [Asset.model_validate(a) for a in json.loads((DATA/'portfolio.json').read_text())]
RETURNS = pd.read_csv(DATA/'historical_returns.csv',index_col='date')
app = FastAPI(title='CapitalGuard',version='1.0.0')
_limits = RiskLimits()
_lock = Lock()
_simulations = OrderedDict()

def limits_snapshot():
    with _lock: return _limits.model_copy(deep=True)

@app.get('/api/portfolio',response_model=Portfolio)
def portfolio():
    return Portfolio(assets=ASSETS,totalValue=sum(a.currentValue for a in ASSETS),historyObservations=len(RETURNS))

@app.get('/api/risk',response_model=RiskReport)
def risk(): return evaluate(ASSETS,RETURNS,limits_snapshot())

@app.get('/api/risk/limits',response_model=RiskLimits)
def get_limits(): return limits_snapshot()

@app.post('/api/risk/limits',response_model=RiskLimits)
def update_limits(value: RiskLimits):
    global _limits
    with _lock: _limits = value.model_copy(deep=True)
    return value

@app.get('/api/simulations',response_model=list[Scenario])
def scenarios():
    return catalog(ASSETS)

@app.post('/api/simulate',response_model=SimulationResult)
def predefined(request: ScenarioRequest):
    return remember(simulate(ASSETS,RETURNS,limits_snapshot(),scenario_id=request.scenarioId))

@app.post('/api/simulate/custom',response_model=SimulationResult)
def custom(request: CustomRequest):
    try:
        return remember(simulate(ASSETS,RETURNS,limits_snapshot(),name=request.name,shocks=request.shocks,asset_shocks=request.assetShocks))
    except ValueError as exc:
        raise HTTPException(status_code=422,detail=str(exc))

@app.post('/api/simulate/withdrawal',response_model=SimulationResult)
def withdrawal(request: WithdrawalRequest):
    amount = request.withdrawalAmount if request.withdrawalAmount is not None else sum(a.currentValue for a in ASSETS)*request.withdrawalPercent/100
    return remember(simulate(ASSETS,RETURNS,limits_snapshot(),withdrawal=amount))


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
