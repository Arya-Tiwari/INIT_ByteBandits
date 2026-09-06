from pathlib import Path
import json
import os
from threading import RLock
from functools import wraps
import math
from uuid import uuid4
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from collections import OrderedDict
import numpy as np
from models import Asset, Portfolio, PortfolioAllocationRequest, RiskLimits, RiskReport, Scenario, ScenarioRequest, CustomRequest, WithdrawalRequest, SimulationResult, RebalanceResult, RouteCapitalRequest, RouteCapitalResponse, MarketSimulationRequest, MarketSimulationResult, AddAssetRequest
from risk_engine import evaluate
from simulation_engine import simulate
from scenarios import catalog
from optimization_engine import optimize
from market_simulation import run_market_simulation
from historical_data import validate_returns

DATA = Path(__file__).parent / 'data'
ASSETS = [Asset.model_validate(a) for a in json.loads((DATA/'portfolio.json').read_text())]
_assets = [asset.model_copy(deep=True) for asset in ASSETS]
RETURNS = pd.read_csv(DATA/'historical_returns.csv',index_col='date')
validate_returns(RETURNS, [asset.id for asset in ASSETS])
app = FastAPI(title='AEGIS',version='1.0.0')
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        *[origin.strip().rstrip('/') for origin in os.getenv('FRONTEND_ORIGINS', '').split(',') if origin.strip()],
    ],
    allow_methods=['*'],
    allow_headers=['*'],
)
_limits = RiskLimits()
_lock = RLock()
_simulations = OrderedDict()

def consistent_state(function):
    """Serialize local demo requests so mutations and cached analyses stay atomic."""
    @wraps(function)
    def wrapped(*args, **kwargs):
        with _lock:
            return function(*args, **kwargs)
    return wrapped

APPETITES = {
    'CONSERVATIVE': RiskLimits(maxPortfolioVolatility=0.12, maxVaR=0.012, maxCVaR=0.018, maxSingleAssetWeight=0.20, maxAssetClassWeight=0.40, minimumLiquidityScore=75, minimumCashWeight=0.08, maximumTurnover=0.15, riskAppetite='CONSERVATIVE'),
    'BALANCED': RiskLimits(maxPortfolioVolatility=0.16, maxVaR=0.018, maxCVaR=0.025, maxSingleAssetWeight=0.25, maxAssetClassWeight=0.55, minimumLiquidityScore=70, minimumCashWeight=0.05, maximumTurnover=0.20, riskAppetite='BALANCED'),
    'GROWTH': RiskLimits(maxPortfolioVolatility=0.22, maxVaR=0.030, maxCVaR=0.040, maxSingleAssetWeight=0.35, maxAssetClassWeight=0.65, minimumLiquidityScore=60, minimumCashWeight=0.03, maximumTurnover=0.30, riskAppetite='GROWTH'),
}

_risk_cache = {}
_optimize_cache = {}

def clear_cache():
    with _lock:
        _risk_cache.clear()
        _optimize_cache.clear()

def limits_snapshot():
    with _lock: return _limits.model_copy(deep=True)

def assets_snapshot():
    with _lock: return [asset.model_copy(deep=True) for asset in _assets]

@app.get('/api/portfolio',response_model=Portfolio)
@consistent_state
def portfolio():
    assets = assets_snapshot()
    return Portfolio(assets=assets,totalValue=sum(a.currentValue for a in assets),historyObservations=len(RETURNS))

@app.post('/api/portfolio',response_model=Portfolio)
@consistent_state
def update_portfolio(request: PortfolioAllocationRequest):
    global _assets
    current = assets_snapshot()
    total = request.totalValue if request.totalValue is not None else sum(asset.currentValue for asset in current)
    allocations = dict(request.allocations) if request.allocations is not None else {asset.id: asset.currentWeight for asset in current}
    expected = {asset.id for asset in current}
    # Auto-fill omitted assets
    for asset in current:
        if asset.id not in allocations:
            if asset.id == 'cash':
                non_cash_sum = sum(v for k, v in allocations.items() if k != 'cash')
                allocations['cash'] = max(0.0, 1.0 - non_cash_sum)
            else:
                allocations[asset.id] = 0.0
    received = set(allocations)
    if received != expected:
        missing, unknown = sorted(expected-received), sorted(received-expected)
        detail = []
        if missing: detail.append('Missing holding IDs: ' + ', '.join(missing))
        if unknown: detail.append('Unknown holding IDs: ' + ', '.join(unknown))
        raise HTTPException(status_code=422, detail='; '.join(detail))
    assumptions = request.assumptions or {}
    unknown_assumptions = sorted(set(assumptions) - expected)
    if unknown_assumptions:
        raise HTTPException(status_code=422, detail='Unknown holding assumption IDs: ' + ', '.join(unknown_assumptions))
    allocation_total = sum(allocations.values())
    if allocation_total > 1.0001:
        raise HTTPException(status_code=422, detail=f'Total target allocation ({allocation_total*100:.1f}%) cannot exceed 100%.')
    normalized = {asset_id: weight / (allocation_total if allocation_total > 0 else 1.0) for asset_id, weight in allocations.items()}
    updated = []
    for asset in current:
        assumption = assumptions.get(asset.id)
        updates = {
            'currentWeight': normalized[asset.id],
            'currentValue': total * normalized[asset.id],
        }
        if assumption is not None:
            updates.update(assumption.model_dump(exclude_none=True))
        updated.append(asset.model_copy(update=updates))
    with _lock: _assets = [asset.model_copy(deep=True) for asset in updated]
    clear_cache()
    return Portfolio(assets=updated,totalValue=total,historyObservations=len(RETURNS))

@app.post('/api/portfolio/add-asset', response_model=Portfolio)
@consistent_state
def add_asset(request: AddAssetRequest):
    global _assets, RETURNS
    current = assets_snapshot()
    new_id = f"asset-{len(current)+1}"
    if any(a.ticker.upper() == request.ticker.upper() for a in current):
        raise HTTPException(status_code=422, detail=f"Holding ticker '{request.ticker}' already exists.")
    
    val = request.currentValueCr * 1e7
    new_total = sum(a.currentValue for a in current) + val
    if not math.isfinite(new_total):
        raise HTTPException(status_code=422, detail='Total capital must remain finite.')
    
    r_annual = request.expectedReturnPercent / 100.0
    v_annual = request.volatilityPercent / 100.0
    
    cls = request.assetClass
    loading = {
        'Equity': (0.82, 0.05, 0.0),
        'International Equity': (0.65, 0.0, 0.0),
        'REIT': (0.60, -0.35, 0.0),
        'Corporate Bonds': (0.20, -0.65, 0.0),
        'Government Bonds': (-0.15, -0.80, 0.0),
        'Gold': (-0.15, 0.0, 0.80),
        'Cash': (0.0, 0.0, 0.0),
    }.get(cls, (0.50, 0.0, 0.0))
    
    rng = np.random.default_rng(len(current) * 1000 + 42)
    market = rng.normal(0, 1, len(RETURNS))
    rates = rng.normal(0, 1, len(RETURNS))
    commodity = rng.normal(0, 1, len(RETURNS))
    
    for k in (130, 131, 400, 401, 610):
        if k < len(RETURNS):
            market[k] -= 3.5
            
    factor = (loading[0]*market + loading[1]*rates + loading[2]*commodity +
              np.sqrt(max(0, 1.0 - sum(x*x for x in loading))) * rng.normal(0, 1, len(RETURNS)))
    
    daily_returns = np.maximum(-.99, (r_annual / 252.0) + (v_annual / np.sqrt(252.0)) * factor)
    
    with _lock:
        RETURNS[new_id] = daily_returns
        new_asset = Asset(
            id=new_id,
            name=request.name,
            ticker=request.ticker.upper(),
            assetClass=request.assetClass,
            currentValue=val,
            currentWeight=val / new_total if new_total > 0 else 0,
            expectedReturn=r_annual,
            volatility=v_annual,
            liquidityScore=request.liquidityScore,
            duration=request.duration,
        )
        updated_assets = current + [new_asset]
        for a in updated_assets:
            a.currentWeight = a.currentValue / new_total if new_total > 0 else 0
        _assets = [a.model_copy(deep=True) for a in updated_assets]
    clear_cache()
    return Portfolio(assets=_assets, totalValue=new_total, historyObservations=len(RETURNS))

@app.post('/api/portfolio/route-capital', response_model=RouteCapitalResponse)
@consistent_state
def route_capital(request: RouteCapitalRequest):
    global _assets
    current = assets_snapshot()
    total = sum(a.currentValue for a in current)
    limits = limits_snapshot()
    report = evaluate(current, RETURNS, limits)
    min_liq = limits.minimumLiquidityScore
    liquidity_before = report.metrics.liquidityScore
    new_total = total + request.incomingCapital
    if not math.isfinite(new_total):
        raise HTTPException(status_code=422, detail='Total capital must remain finite.')
    # Capital not used for repair follows the existing allocation and therefore
    # retains the current liquidity score. Solve the weighted-average equation
    # for the amount that must be placed in 100/100 Cash to reach the floor.
    needed_liq = 0.0 if liquidity_before >= min_liq else (
        (min_liq - liquidity_before) * new_total / (100.0 - liquidity_before)
    )
    routed = min(request.incomingCapital, needed_liq)
    remaining = request.incomingCapital - routed

    # Deterministic Allocation Rule:
    # 1. 'routed' amount goes directly to Cash (or liquid holdings) to repair liquidity deficit.
    # 2. 'remaining' capital is allocated proportionally across ALL holdings based on existing weights.
    # Total added across all assets equals incomingCapital exactly; new total equals total + incomingCapital.
    updated = []
    cash_assets = [a for a in current if a.assetClass == 'Cash']
    if routed > 0 and not cash_assets:
        raise HTTPException(status_code=409, detail='Liquidity repair requires a Cash holding, but none is configured.')
    cash_total = sum(a.currentValue for a in cash_assets)
    for a in current:
        cash_share = (a.currentValue / cash_total if cash_total > 0 else 1 / len(cash_assets)) if a.assetClass == 'Cash' else 0.0
        proportional_share = a.currentValue / total if total > 0 else 1 / len(current)
        add_val = routed * cash_share + remaining * proportional_share
        new_val = a.currentValue + add_val
        updated.append(a.model_copy(update={
            'currentValue': new_val,
            'currentWeight': new_val / new_total if new_total > 0 else 0
        }))
    with _lock:
        _assets = [a.model_copy(deep=True) for a in updated]
    clear_cache()
    liquidity_after = evaluate(updated, RETURNS, limits).metrics.liquidityScore
    return RouteCapitalResponse(routedToLiquidity=routed, remainingCapital=remaining,
        updatedAssets=updated, totalValue=new_total, liquidityBefore=liquidity_before,
        liquidityAfter=liquidity_after, liquidityTarget=min_liq,
        liquidityRepaired=liquidity_after + 1e-8 >= min_liq)

@app.post('/api/reset')
@consistent_state
def reset_demo():
    """Restore AEGIS to original hackathon demo baseline state."""
    global _assets, _limits
    with _lock:
        _assets = [asset.model_copy(deep=True) for asset in ASSETS]
        _limits = RiskLimits()
        _simulations.clear()
        RETURNS.drop(columns=[column for column in RETURNS if column not in {a.id for a in ASSETS}], inplace=True)
    clear_cache()
    current = assets_snapshot()
    limits = limits_snapshot()
    return {
        "status": "RESET",
        "message": "AEGIS demo state restored to original baseline.",
        "portfolio": Portfolio(assets=current, totalValue=sum(a.currentValue for a in current), historyObservations=len(RETURNS)),
        "limits": limits
    }

@app.get('/api/risk',response_model=RiskReport)
@consistent_state
def risk():
    with _lock:
        if 'report' in _risk_cache:
            return _risk_cache['report'].model_copy(deep=True)
    report = evaluate(assets_snapshot(),RETURNS,limits_snapshot())
    with _lock:
        _risk_cache['report'] = report
    return report

@app.get('/api/risk/limits',response_model=RiskLimits)
@consistent_state
def get_limits(): return limits_snapshot()

@app.get('/api/risk/appetites', response_model=dict[str, RiskLimits])
@consistent_state
def get_appetites(): return APPETITES

@app.post('/api/risk/limits',response_model=RiskLimits)
@consistent_state
def update_limits(value: RiskLimits):
    global _limits
    with _lock: _limits = value.model_copy(deep=True)
    clear_cache()
    return value

@app.get('/api/simulations',response_model=list[Scenario])
@consistent_state
def scenarios():
    return catalog(assets_snapshot())

@app.post('/api/optimize',response_model=RebalanceResult)
@consistent_state
def optimize_portfolio():
    """Return a funded proposal for the current portfolio; never execute it."""
    with _lock:
        if 'result' in _optimize_cache:
            return _optimize_cache['result'].model_copy(deep=True)
    assets = assets_snapshot()
    total = sum(a.currentValue for a in assets)
    result = optimize(assets, RETURNS, limits_snapshot(), original_capital=total)
    with _lock:
        _optimize_cache['result'] = result
    return result

@app.post('/api/simulate',response_model=SimulationResult)
@consistent_state
def predefined(request: ScenarioRequest):
    return remember(simulate(assets_snapshot(),RETURNS,limits_snapshot(),scenario_id=request.scenarioId))

@app.post('/api/simulate/custom',response_model=SimulationResult)
@consistent_state
def custom(request: CustomRequest):
    try:
        return remember(simulate(assets_snapshot(),RETURNS,limits_snapshot(),name=request.name,shocks=request.shocks,asset_shocks=request.assetShocks))
    except ValueError as exc:
        raise HTTPException(status_code=422,detail=str(exc))

@app.post('/api/simulate/withdrawal',response_model=SimulationResult)
@consistent_state
def withdrawal(request: WithdrawalRequest):
    assets = assets_snapshot()
    amount = request.withdrawalAmount if request.withdrawalAmount is not None else sum(a.currentValue for a in assets)*request.withdrawalPercent/100
    return remember(simulate(assets,RETURNS,limits_snapshot(),withdrawal=amount))

@app.post('/api/simulate/market', response_model=MarketSimulationResult)
@consistent_state
def market_simulation(request: MarketSimulationRequest):
    try:
        return run_market_simulation(assets_snapshot(), RETURNS, limits_snapshot(), request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


def remember(result):
    result.simulationId = uuid4().hex
    with _lock:
        _simulations[result.simulationId] = result.model_copy(deep=True)
        while len(_simulations) > 128: _simulations.popitem(last=False)
    return result

@app.post('/api/simulate/{simulation_id}/rebalance',response_model=RebalanceResult)
@consistent_state
def rebalance(simulation_id: str):
    with _lock:
        saved = _simulations.get(simulation_id)
        if saved is None: raise HTTPException(status_code=404, detail='Simulation expired. Run the scenario again.')
        saved = saved.model_copy(deep=True)
        current_limits = _limits.model_copy(deep=True)
    if current_limits != saved.limits:
        raise HTTPException(status_code=409,detail='Risk limits changed. Run the scenario again before requesting a rebalance.')
    # Ex-ante resilience: optimize the unchanged current portfolio, then apply
    # the exact same saved holding shocks. This is separate from repairing the
    # already-stressed portfolio returned above.
    baseline_target = None
    if saved.assumptions:
        assumption_by_id = {assumption.assetId: assumption for assumption in saved.assumptions}
        current_assets = [asset.model_copy(update={
            'currentValue': impact.originalValue,
            'currentWeight': impact.originalWeight,
            'liquidityScore': assumption_by_id[asset.id].liquidityBefore,
        }) for asset, impact in zip(saved.stressedAssets, saved.assetImpacts)]
        baseline_target = optimize(current_assets, RETURNS, current_limits,
            original_capital=sum(a.currentValue for a in current_assets))
    result = optimize(saved.stressedAssets, RETURNS, current_limits,
        original_capital=saved.originalPortfolioValue, consumed_turnover=saved.riskAfter.metrics.turnover)
    if baseline_target is not None:
        if baseline_target.status == 'FEASIBLE' and baseline_target.assets:
            by_id = {assumption.assetId: assumption for assumption in saved.assumptions}
            stressed_target = []
            for asset in baseline_target.assets:
                assumption = by_id[asset.id]
                liquidity_ratio = assumption.liquidityAfter / assumption.liquidityBefore if assumption.liquidityBefore else 1
                stressed_target.append(asset.model_copy(update={
                    'currentValue': asset.currentValue * (1 + assumption.shockPercent / 100),
                    'liquidityScore': asset.liquidityScore * liquidity_ratio,
                }))
            optimized_value = sum(a.currentValue for a in stressed_target)
            for asset in stressed_target:
                asset.currentWeight = asset.currentValue / optimized_value if optimized_value else 0
            optimized_risk = evaluate(stressed_target, RETURNS, current_limits)
            optimized_loss = baseline_target.totalValue - optimized_value
            result.scenarioComparison = {
                'currentLoss': saved.marketLoss,
                'optimizedLoss': optimized_loss,
                'capitalProtected': saved.marketLoss - optimized_loss,
                'currentLossPercent': saved.marketLoss / saved.originalPortfolioValue if saved.originalPortfolioValue else 0,
                'optimizedLossPercent': optimized_loss / baseline_target.totalValue if baseline_target.totalValue else 0,
                'currentBreaches': float(len(saved.breachedControls)),
                'optimizedBreaches': float(sum(c.status == 'BREACH' for c in optimized_risk.controls)),
            }
    return result

DIST_DIR = Path(__file__).parent.parent / 'frontend' / 'dist'
if DIST_DIR.exists():
    app.mount('/', StaticFiles(directory=str(DIST_DIR), html=True), name='static')
