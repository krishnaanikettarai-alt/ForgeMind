"""Deterministic sensor metrics and explicitly unvalidated threshold checks."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Sequence

from .data import SensorReading


DEFAULT_THRESHOLDS = {
    "vibration": 5.0,
    "temperature": 80.0,
    "current": 30.0,
}
THRESHOLD_SOURCE = "application demo default; not industry-validated"


@dataclass(frozen=True)
class ThresholdConfig:
    vibration: float
    temperature: float
    current: float
    source: str
    status: str = "unvalidated"

    def as_dict(self) -> dict[str, float | str]:
        return {
            "vibration": self.vibration,
            "temperature": self.temperature,
            "current": self.current,
            "source": self.source,
            "status": self.status,
        }


def _threshold(name: str) -> float:
    raw_value = os.getenv(f"FORGEMIND_THRESHOLD_{name.upper()}")
    if raw_value is None:
        return DEFAULT_THRESHOLDS[name]
    try:
        value = float(raw_value)
    except ValueError as exc:
        raise ValueError(
            f"FORGEMIND_THRESHOLD_{name.upper()} must be a number"
        ) from exc
    if value < 0:
        raise ValueError(f"FORGEMIND_THRESHOLD_{name.upper()} must be non-negative")
    return value


def threshold_config() -> ThresholdConfig:
    configured = any(
        os.getenv(f"FORGEMIND_THRESHOLD_{name.upper()}") is not None
        for name in DEFAULT_THRESHOLDS
    )
    return ThresholdConfig(
        vibration=_threshold("vibration"),
        temperature=_threshold("temperature"),
        current=_threshold("current"),
        source=(
            "environment configuration; not industry-validated"
            if configured
            else THRESHOLD_SOURCE
        ),
    )


def _percentage_change(first: float, last: float) -> float | None:
    if first == 0:
        return None
    return ((last - first) / abs(first)) * 100


def _trend_direction(values: Sequence[float]) -> str:
    if len(values) < 2:
        return "insufficient_data"
    change = values[-1] - values[0]
    if change > 0:
        return "increasing"
    if change < 0:
        return "decreasing"
    return "flat"


def _metric(values: Sequence[float], window: int) -> dict[str, float | int | str | None]:
    first = values[0]
    last = values[-1]
    recent_values = values[-window:]
    return {
        "readingsAnalyzed": len(values),
        "firstObserved": first,
        "lastObserved": last,
        "absoluteChange": last - first,
        "percentageChange": _percentage_change(first, last),
        "recentMovingAverage": (
            sum(recent_values) / len(recent_values) if len(values) >= window else None
        ),
        "trendDirection": _trend_direction(values),
    }


def _flag(
    metric: dict[str, float | int | str | None],
    threshold: float,
    source: str,
) -> dict[str, bool | float | str]:
    last_observed = metric["lastObserved"]
    assert isinstance(last_observed, (int, float))
    return {
        "flagged": last_observed >= threshold,
        "observedValue": last_observed,
        "threshold": threshold,
        "comparison": "last observed value >= threshold",
        "source": source,
        "status": "unvalidated",
    }


def analyze_readings(
    readings: Sequence[SensorReading],
    machine_id: str,
    window: int,
    thresholds: ThresholdConfig | None = None,
) -> dict[str, object]:
    if not readings:
        raise ValueError("At least one reading is required")
    if window < 1:
        raise ValueError("Analysis window must be at least 1")
    thresholds = thresholds or threshold_config()
    vibration = [reading.vibration_mm_s for reading in readings]
    temperature = [reading.temperature_c for reading in readings]
    current = [reading.current_a for reading in readings]
    metrics = {
        "vibration": _metric(vibration, window),
        "temperature": _metric(temperature, window),
        "current": _metric(current, window),
    }
    flags = {
        "vibration": _flag(metrics["vibration"], thresholds.vibration, thresholds.source),
        "temperature": _flag(metrics["temperature"], thresholds.temperature, thresholds.source),
        "current": _flag(metrics["current"], thresholds.current, thresholds.source),
    }
    observed = {
        name: {
            "readingsAnalyzed": metric["readingsAnalyzed"],
            "firstObserved": metric["firstObserved"],
            "lastObserved": metric["lastObserved"],
        }
        for name, metric in metrics.items()
    }
    derived = {
        name: {
            "absoluteChange": metric["absoluteChange"],
            "percentageChange": metric["percentageChange"],
            "recentMovingAverage": metric["recentMovingAverage"],
            "trendDirection": metric["trendDirection"],
        }
        for name, metric in metrics.items()
    }
    return {
        "machineId": machine_id,
        "source": "synthetic",
        "timeRange": {
            "firstTimestamp": readings[0].timestamp,
            "lastTimestamp": readings[-1].timestamp,
        },
        "analysis": {
            "window": window,
            "observedMeasurements": observed,
            "derivedMetrics": derived,
            "thresholdFlags": flags,
            "thresholds": thresholds.as_dict(),
        },
        "limitations": [
            "Metrics are deterministic summaries of observed sensor readings.",
            "Threshold flags are configurable application checks and are not validated operational limits.",
            "No trained-model failure probability, health score, or diagnosis is calculated.",
        ],
    }
