"""Leakage-safe feature and label construction for historical telemetry."""

from __future__ import annotations

from datetime import timedelta
from typing import Iterable

import pandas as pd

TELEMETRY_COLUMNS = ["datetime", "machineID", "volt", "rotate", "pressure", "vibration"]
VALUE_COLUMNS = ["volt", "rotate", "pressure", "vibration"]
DEFAULT_ROLLING_WINDOW = 6


def _normalise_telemetry(telemetry: pd.DataFrame) -> pd.DataFrame:
    missing = set(TELEMETRY_COLUMNS) - set(telemetry.columns)
    if missing:
        raise ValueError(f"Telemetry is missing columns: {sorted(missing)}")
    frame = telemetry[TELEMETRY_COLUMNS].copy()
    frame["datetime"] = pd.to_datetime(frame["datetime"], errors="raise")
    frame["machineID"] = pd.to_numeric(frame["machineID"], errors="raise").astype(int)
    for column in VALUE_COLUMNS:
        frame[column] = pd.to_numeric(frame[column], errors="raise")
    return frame.sort_values(["machineID", "datetime"], kind="mergesort").reset_index(drop=True)


def build_features(
    telemetry: pd.DataFrame,
    rolling_window: int = DEFAULT_ROLLING_WINDOW,
) -> pd.DataFrame:
    """Build rows using only the current and earlier readings for each machine."""
    if rolling_window < 2:
        raise ValueError("rolling_window must be at least 2")
    frame = _normalise_telemetry(telemetry)
    feature_frame = frame[["datetime", "machineID"]].copy()
    for column in VALUE_COLUMNS:
        feature_frame[column] = frame[column]
        grouped = frame.groupby("machineID", sort=False)[column]
        rolling = grouped.rolling(rolling_window, min_periods=1)
        feature_frame[f"{column}_rolling_mean"] = rolling.mean().reset_index(level=0, drop=True)
        feature_frame[f"{column}_rolling_std"] = (
            rolling.std(ddof=0).reset_index(level=0, drop=True).fillna(0.0)
        )
        feature_frame[f"{column}_trend"] = grouped.diff().fillna(0.0)
    return feature_frame.reset_index(drop=True)


def build_labels(
    telemetry: pd.DataFrame,
    failures: pd.DataFrame,
    horizon_hours: int = 24,
) -> pd.Series:
    """Label a row when the same numeric machine fails strictly after it within the horizon."""
    if horizon_hours <= 0:
        raise ValueError("horizon_hours must be positive")
    frame = _normalise_telemetry(telemetry)
    required = {"datetime", "machineID"}
    if not required.issubset(failures.columns):
        raise ValueError("Failures must contain datetime and machineID columns")
    failure_frame = failures[["datetime", "machineID"]].copy()
    failure_frame["datetime"] = pd.to_datetime(failure_frame["datetime"], errors="raise")
    failure_frame["machineID"] = pd.to_numeric(
        failure_frame["machineID"], errors="raise"
    ).astype(int)
    failure_times = {
        machine: values.to_list()
        for machine, values in failure_frame.groupby("machineID")["datetime"]
    }
    horizon = timedelta(hours=horizon_hours)
    labels = [
        int(any(timestamp < failure <= timestamp + horizon for failure in failure_times.get(machine, [])))
        for machine, timestamp in zip(frame["machineID"], frame["datetime"])
    ]
    return pd.Series(labels, index=frame.index, name="target", dtype="int8")


def make_training_frame(
    telemetry: pd.DataFrame,
    failures: pd.DataFrame,
    rolling_window: int = DEFAULT_ROLLING_WINDOW,
    horizon_hours: int = 24,
) -> pd.DataFrame:
    features = build_features(telemetry, rolling_window)
    labels = build_labels(telemetry, failures, horizon_hours)
    result = features.copy()
    result["target"] = labels.to_numpy()
    return result.sort_values("datetime", kind="mergesort").reset_index(drop=True)


def feature_columns(frame: pd.DataFrame) -> list[str]:
    excluded = {"datetime", "machineID", "target"}
    return [column for column in frame.columns if column not in excluded]


def telemetry_records_to_frame(records: Iterable[dict[str, object]]) -> pd.DataFrame:
    frame = pd.DataFrame(list(records))
    return _normalise_telemetry(frame)
