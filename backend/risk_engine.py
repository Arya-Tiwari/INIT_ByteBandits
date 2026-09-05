"""Deterministic long-only risk; rates are fractions, liquidity is 0–100."""
import numpy as np
import pandas as pd
from .models import Asset, RiskLimits, RiskReport, Metrics, Control, Component


def evaluate(assets: list[Asset], returns: pd.DataFrame, limits: RiskLimits, turnover: float = 0) -> RiskReport:
    values = np.array([a.currentValue for a in assets], dtype=float)
    total = values.sum()
    weights = values / total if total > 0 else np.zeros(len(assets))
    series = returns[[a.id for a in assets]].to_numpy(dtype=float)
    if len(series) < 2 or not np.isfinite(series).all():
        raise ValueError('At least two finite return observations are required.')
    daily = series @ weights
    covariance = np.atleast_2d(np.cov(series, rowvar=False, ddof=1))
    volatility = float(np.sqrt(max(0, weights @ covariance @ weights) * 252))
    losses = -daily
    var = max(0., float(np.quantile(losses, .95)))
    tail = losses[losses >= np.quantile(losses, .95)]
    cvar = max(var, float(tail.mean()))
    wealth = np.r_[1., np.cumprod(1 + daily)]
    drawdown = float(np.max(1 - wealth / np.maximum.accumulate(wealth)))
    classes: dict[str, float] = {}
    for a, w in zip(assets, weights):
        classes[a.assetClass] = classes.get(a.assetClass, 0) + float(w)
    largest_class = max(classes, key=classes.get)
    largest_asset = assets[int(np.argmax(weights))]
    liquidity = float(weights @ np.array([a.liquidityScore for a in assets]))
    expected_return = float(weights @ np.array([a.expectedReturn for a in assets]))
    sharpe = (expected_return - .04) / volatility if volatility > 0 else 0.
    metrics = Metrics(expectedReturn=expected_return,
        volatility=volatility, sharpeRatio=float(sharpe), var95=var, cvar95=cvar, maxDrawdown=drawdown,
        liquidityScore=liquidity, concentrationRisk=float(weights @ weights),
        largestAssetExposure=float(max(weights)), largestAssetName=largest_asset.name,
        largestAssetClassExposure=classes[largest_class], largestAssetClass=largest_class,
        cashWeight=classes.get('Cash', 0), turnover=turnover)
    from .firewall import check
    controls = check(metrics, limits)
    # Reference scales are absolute, so changing a limit cannot hide underlying risk.
    raw = [('Volatility', volatility / .30, .25), ('Tail loss', (var/.04 + cvar/.06)/2, .25),
        ('Concentration', metrics.concentrationRisk, .20), ('Illiquidity', 1-liquidity/100, .15),
        ('Control pressure', sum(1 if c.status == 'BREACH' else .5 if c.status == 'WARNING' else 0 for c in controls)/len(controls), .15)]
    components = [Component(name=n, normalizedScore=float(np.clip(v,0,1)*100), weight=w,
        contribution=float(np.clip(v,0,1)*100*w)) for n,v,w in raw]
    score = round(sum(c.contribution for c in components), 2)
    explanations = [c.explanation for c in controls if c.status != 'PASS']
    explanations += [f'{largest_class} is the largest asset class at {classes[largest_class]:.1%}.',
        f'Historical one-day expected shortfall is {cvar:.2%}; annualized volatility is {volatility:.2%}.']
    cvar_breached = any(c.controlName == 'maxCVaR' and c.status == 'BREACH' for c in controls)
    operating_mode = 'DEFENSIVE' if (cvar_breached or drawdown > .20) else 'CAUTION' if any(c.status == 'BREACH' for c in controls) else 'NORMAL'
    return RiskReport(metrics=metrics, controls=controls, riskScore=score,
        riskLevel='LOW' if score < 25 else 'MODERATE' if score < 50 else 'HIGH' if score < 75 else 'CRITICAL',
        operatingMode=operating_mode,
        components=components, explanations=explanations)
