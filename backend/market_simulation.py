"""Historical, Monte Carlo and hybrid portfolio simulation.

All stochastic parameters come from the validated local return history. A fixed
request seed makes Monte Carlo and hybrid requests reproducible. The same paths
are applied to current and proposed allocations for an apples-to-apples result.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .historical_data import moments, select_period, validate_returns
from .models import DecisionStep, MarketSimulationRequest, MarketSimulationResult, SimulationStatistics
from .optimization_engine import optimize
from .scenarios import DEFINITIONS, assumptions


CONTROL_FIELDS = (
    ('maxPortfolioVolatility', 'maxPortfolioVolatility'),
    ('maxVaR', 'maxVaR'),
    ('maxCVaR', 'maxCVaR'),
    ('maxSingleAssetWeight', 'maxSingleAssetWeight'),
    ('maxAssetClassWeight', 'maxAssetClassWeight'),
    ('minimumLiquidityScore', 'minimumLiquidityScore'),
    ('minimumCashWeight', 'minimumCashWeight'),
    ('maximumTurnover', 'maximumTurnover'),
)


def _rolling_paths(values: np.ndarray, horizon: int) -> np.ndarray:
    if len(values) < horizon:
        raise ValueError(f'The selected period has {len(values)} observations; at least {horizon} are required for a {horizon}-day simulation.')
    return np.stack([values[i:i + horizon] for i in range(len(values) - horizon + 1)])


def _drawdown(path_returns: np.ndarray) -> np.ndarray:
    wealth = np.cumprod(1 + path_returns, axis=1)
    peaks = np.maximum.accumulate(np.concatenate([np.ones((len(wealth), 1)), wealth], axis=1), axis=1)[:, 1:]
    return np.max(1 - wealth / peaks, axis=1)


def _terminal_assets(paths: np.ndarray) -> np.ndarray:
    return np.prod(1 + paths, axis=1) - 1


def _breach_statistics(terminal: np.ndarray, assets, returns: pd.DataFrame, limits, liquidity: np.ndarray):
    initial = np.array([a.currentValue for a in assets], dtype=float)
    values = np.maximum(0., initial[None, :] * (1 + terminal))
    totals = values.sum(axis=1)
    weights = np.divide(values, totals[:, None], out=np.zeros_like(values), where=totals[:, None] > 0)
    covariance = np.atleast_2d(np.cov(returns.to_numpy(dtype=float), rowvar=False, ddof=1))
    volatility = np.sqrt(np.maximum(0., np.einsum('ij,jk,ik->i', weights, covariance, weights) * 252))
    daily = returns.to_numpy(dtype=float) @ weights.T
    losses = -daily
    var = np.maximum(0., np.quantile(losses, .95, axis=0))
    cvar = np.array([max(var[i], losses[:, i][losses[:, i] >= var[i] - 1e-15].mean()) for i in range(len(var))])
    max_single = weights.max(axis=1)
    classes = sorted({a.assetClass for a in assets})
    class_weights = np.column_stack([weights[:, [a.assetClass == cls for a in assets]].sum(axis=1) for cls in classes])
    max_class = class_weights.max(axis=1)
    liquidity_score = weights @ liquidity
    cash = weights[:, [a.assetClass == 'Cash' for a in assets]].sum(axis=1)
    breaches = {
        'maxPortfolioVolatility': volatility > limits.maxPortfolioVolatility + 1e-8,
        'maxVaR': var > limits.maxVaR + 1e-8,
        'maxCVaR': cvar > limits.maxCVaR + 1e-8,
        'maxSingleAssetWeight': max_single > limits.maxSingleAssetWeight + 1e-8,
        'maxAssetClassWeight': max_class > limits.maxAssetClassWeight + 1e-8,
        'minimumLiquidityScore': liquidity_score < limits.minimumLiquidityScore - 1e-8,
        'minimumCashWeight': cash < limits.minimumCashWeight - 1e-8,
        'maximumTurnover': np.zeros(len(weights), dtype=bool),
    }
    matrix = np.column_stack(list(breaches.values()))
    return {name: float(flags.mean()) for name, flags in breaches.items()}, float(matrix.any(axis=1).mean()), float(matrix.sum(axis=1).mean())


def _statistics(paths: np.ndarray, assets, returns: pd.DataFrame, limits, liquidity: np.ndarray) -> SimulationStatistics:
    terminal = _terminal_assets(paths)
    weights = np.array([a.currentValue for a in assets], dtype=float)
    weights = weights / weights.sum()
    outcomes = terminal @ weights
    portfolio_daily = np.einsum('rha,a->rh', paths, weights)
    losses = -outcomes
    control_probs, any_prob, average = _breach_statistics(terminal, assets, returns, limits, liquidity)
    return SimulationStatistics(
        expectedReturn=float(outcomes.mean()),
        expectedLoss=float(np.maximum(losses, 0).mean()),
        volatility=float(outcomes.std(ddof=1)) if len(outcomes) > 1 else 0.,
        downside5=float(np.quantile(outcomes, .05)),
        var95=max(0., float(np.quantile(losses, .95))),
        worstLoss=max(0., float(losses.max())),
        maxDrawdown=float(_drawdown(portfolio_daily).max()),
        probabilityAnyBreach=any_prob,
        averageBreaches=average,
        controlBreachProbabilities=control_probs,
    )


def run_market_simulation(assets, returns: pd.DataFrame, limits, request: MarketSimulationRequest) -> MarketSimulationResult:
    asset_ids = [a.id for a in assets]
    validated = validate_returns(returns, asset_ids)
    selected = select_period(validated, request.startDate, request.endDate)
    period_start, period_end = str(selected.index[0]), str(selected.index[-1])
    mean, covariance = moments(selected)
    overlay_name = None
    overlay_assumptions = None

    if request.mode == 'HISTORICAL':
        paths = _rolling_paths(selected.to_numpy(dtype=float), request.horizonDays)
        model_label = 'Historical rolling periods'
    else:
        rng = np.random.default_rng(request.seed)
        paths = rng.multivariate_normal(mean, covariance, size=(request.runs, request.horizonDays))
        paths = np.clip(paths, -.99, None)
        model_label = 'Monte Carlo · historical mean and covariance'
        if request.mode == 'HYBRID':
            scenario_id = request.stressScenarioId or 'market-crash'
            overlay_assumptions = assumptions(assets, scenario_id)
            factors = np.array([1 + a.shockPercent / 100 for a in overlay_assumptions])
            paths[:, -1, :] = np.maximum(-.999999, (1 + paths[:, -1, :]) * factors - 1)
            overlay_name = DEFINITIONS[scenario_id]['name']
            model_label = 'Hybrid · historical baseline + Monte Carlo + stress overlay'

    liquidity = np.array([a.liquidityScore for a in assets], dtype=float)
    if overlay_assumptions:
        liquidity = np.array([a.liquidityAfter for a in overlay_assumptions], dtype=float)
    original = _statistics(paths, assets, validated, limits, liquidity)
    proposal = optimize(assets, validated, limits, original_capital=sum(a.currentValue for a in assets))
    optimized = None
    if proposal.status == 'FEASIBLE' and proposal.assets:
        optimized_liquidity = np.array([a.liquidityScore for a in proposal.assets], dtype=float)
        if overlay_assumptions:
            ratios = np.divide(liquidity, np.array([a.liquidityScore for a in assets]), out=np.ones(len(assets)), where=np.array([a.liquidityScore for a in assets]) > 0)
            optimized_liquidity *= ratios
        optimized = _statistics(paths, proposal.assets, validated, limits, optimized_liquidity)
    improvement = 0. if not optimized else optimized.downside5 - original.downside5
    trail = [
        DecisionStep(stage='data', message=f'Validated {len(selected)} synthetic historical observations from {period_start} to {period_end}.'),
        DecisionStep(stage='simulation', message=f'Applied {len(paths)} matched {request.horizonDays}-day paths to the current portfolio.'),
        DecisionStep(stage='control', message=f'At least one Risk Firewall control was breached in {original.probabilityAnyBreach:.1%} of current-portfolio paths.'),
    ]
    if overlay_name:
        trail.insert(2, DecisionStep(stage='stress', message=f'Injected the centralized {overlay_name} assumptions into every simulated path.'))
    trail.append(DecisionStep(stage='optimization', message=(f'The same paths produced a {optimized.probabilityAnyBreach:.1%} breach probability for the proposed allocation.' if optimized else 'No verified optimized allocation was available for comparison.')))
    return MarketSimulationResult(mode=request.mode, modelLabel=model_label,
        dataSource='Local synthetic historical return dataset; no live market feed',
        periodStart=period_start, periodEnd=period_end, runs=len(paths),
        horizonDays=request.horizonDays, stressOverlay=overlay_name, original=original,
        optimized=optimized, optimizedAvailable=optimized is not None,
        resilienceImprovement=improvement,
        explanation='Results are scenario distributions derived from the local synthetic return history. They are model outputs, not forecasts or investment guarantees.',
        decisionTrail=trail)
