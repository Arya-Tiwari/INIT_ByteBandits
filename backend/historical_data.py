"""Validated access to the local synthetic historical-return dataset."""
from __future__ import annotations

import numpy as np
import pandas as pd


def validate_returns(returns: pd.DataFrame, asset_ids: list[str]) -> pd.DataFrame:
    missing = [asset_id for asset_id in asset_ids if asset_id not in returns.columns]
    if missing:
        raise ValueError('Historical return data is missing holdings: ' + ', '.join(missing))
    frame = returns[asset_ids].copy()
    values = frame.to_numpy(dtype=float)
    if len(frame) < 2:
        raise ValueError('At least two historical observations are required.')
    if not np.isfinite(values).all():
        raise ValueError('Historical return data contains missing or non-finite values.')
    return frame


def select_period(returns: pd.DataFrame, start_date: str | None, end_date: str | None) -> pd.DataFrame:
    frame = returns.copy()
    try:
        index = pd.to_datetime(frame.index, errors='raise')
        start = pd.Timestamp(start_date) if start_date else index.min()
        end = pd.Timestamp(end_date) if end_date else index.max()
    except (ValueError, TypeError) as exc:
        raise ValueError('Historical dates must use YYYY-MM-DD and exist in the local dataset period.') from exc
    if start > end:
        raise ValueError('Historical start date must be on or before the end date.')
    selected = frame.loc[(index >= start) & (index <= end)]
    if len(selected) < 2:
        raise ValueError('The selected historical period must contain at least two observations.')
    return selected


def moments(returns: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    values = returns.to_numpy(dtype=float)
    return values.mean(axis=0), np.atleast_2d(np.cov(values, rowvar=False, ddof=1))
