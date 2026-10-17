"""Leakage-safe feature and label construction for historical telemetry."""

from __future__ import annotations

import math
from bisect import bisect_right
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
    machine_ids = pd.to_numeric(frame["machineID"], errors="raise")
    if (
        machine_ids.isna().any()
        or not machine_ids.map(math.isfinite).all()
        or (machine_ids < 1).any()
        or (machine_ids % 1 != 0).any()
    ):
        raise ValueError("machineID values must be positive integers")
    frame["machineID"] = machine_ids.astype(int)
    for column in VALUE_COLUMNS:
        frame[column] = pd.to_numeric(frame[column], errors="raise")
        if not frame[column].map(math.isfinite).all():
            raise ValueError(f"{column} values must be finite numbers")
    if frame["datetime"].isna().any():
        raise ValueError("datetime values must not be missing")
    if frame.duplicated(["machineID", "datetime"]).any():
        raise ValueError("Telemetry must not contain duplicate machine timestamps")
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
    failure_machine_ids = pd.to_numeric(
        failure_frame["machineID"], errors="raise"
    )
    if (
        failure_machine_ids.isna().any()
        or not failure_machine_ids.map(math.isfinite).all()
        or (failure_machine_ids < 1).any()
        or (failure_machine_ids % 1 != 0).any()
    ):
        raise ValueError("Failure machineID values must be positive integers")
    if failure_frame["datetime"].isna().any():
        raise ValueError("Failure datetime values must not be missing")
    failure_frame["machineID"] = failure_machine_ids.astype(int)
    failure_times = {
        machine: sorted(values.to_list())
        for machine, values in failure_frame.groupby("machineID")["datetime"]
    }
    horizon = timedelta(hours=horizon_hours)
    labels = []
    for machine, timestamp in zip(frame["machineID"], frame["datetime"]):
        machine_failures = failure_times.get(machine, [])
        next_failure = bisect_right(machine_failures, timestamp)
        labels.append(
            int(
                next_failure < len(machine_failures)
                and machine_failures[next_failure] <= timestamp + horizon
            )
        )
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
