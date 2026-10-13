"""Artifact-backed historical failure-risk inference."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import joblib
import pandas as pd

from .features import build_features, feature_columns, telemetry_records_to_frame


class PredictionError(ValueError):
    """Raised for unsupported IDs or insufficient/invalid telemetry history."""


@dataclass(frozen=True)
class PredictionResult:
    machine_id: int | str
    risk_score: float | None
    risk_level: str
    prediction_horizon_hours: int
    model_version: str
    as_of_timestamp: str | None
    signals: list[str]
    limitations: list[str]
    status: str = "available"

    def as_dict(self) -> dict[str, Any]:
        return {
            "machine_id": self.machine_id,
            "risk_score": self.risk_score,
            "risk_level": self.risk_level,
            "prediction_horizon_hours": self.prediction_horizon_hours,
            "model_version": self.model_version,
            "as_of_timestamp": self.as_of_timestamp,
            "signals": self.signals,
            "limitations": self.limitations,
            "status": self.status,
        }


class HistoricalFailurePredictor:
    def __init__(self, artifact_path: str | Path):
        self.artifact_path = Path(artifact_path)
        if not self.artifact_path.is_file():
            raise FileNotFoundError(f"Model artifact not found: {self.artifact_path}")
        self.artifact = joblib.load(self.artifact_path)
        self.model = self.artifact["model"]
        self.feature_names = self.artifact["feature_names"]
        self.rolling_window = int(self.artifact["rolling_window"])
        self.horizon_hours = int(self.artifact["horizon_hours"])
        self.model_version = str(self.artifact["model_version"])
        self.minimum_history = max(2, int(self.artifact.get("minimum_history", 2)))

    def predict(
        self,
        machine_id: int | str,
        telemetry_history: pd.DataFrame | Iterable[dict[str, object]],
    ) -> PredictionResult:
        if isinstance(machine_id, str) and machine_id.startswith("M"):
            return PredictionResult(
                machine_id=machine_id,
                risk_score=None,
                risk_level="unsupported",
                prediction_horizon_hours=self.horizon_hours,
                model_version=self.model_version,
                as_of_timestamp=None,
                signals=[],
                limitations=[
                    "Synthetic M-prefixed machines are a separate data namespace.",
                    "No calibrated historical-model risk is available for synthetic machines.",
                ],
                status="unsupported",
            )
        try:
            numeric_id = int(machine_id)
        except (TypeError, ValueError) as exc:
            raise PredictionError("machine_id must be a historical numeric ID") from exc
        raw_frame = (
            telemetry_history.copy()
            if isinstance(telemetry_history, pd.DataFrame)
            else pd.DataFrame(list(telemetry_history))
        )
        frame = telemetry_records_to_frame(raw_frame.to_dict("records"))
        frame = frame[frame["machineID"] == numeric_id]
        if len(frame) < self.minimum_history:
            raise PredictionError(f"At least {self.minimum_history} readings are required")
        features = build_features(frame, self.rolling_window).sort_values("datetime")
        latest = features.iloc[[-1]]
        score = float(self.model.predict_proba(latest[self.feature_names])[0, 1])
        risk_level = "high" if score >= 0.66 else "medium" if score >= 0.33 else "low"
        signals = [
            column.replace("_", " ")
            for column in self.feature_names
            if column.endswith("_trend") and float(latest.iloc[0][column]) > 0
        ]
        as_of = pd.Timestamp(latest.iloc[0]["datetime"]).isoformat()
        return PredictionResult(
            machine_id=numeric_id,
            risk_score=score,
            risk_level=risk_level,
            prediction_horizon_hours=self.horizon_hours,
            model_version=self.model_version,
            as_of_timestamp=as_of,
            signals=signals,
            limitations=[
                "Risk-level thresholds are application policy, not validated industrial thresholds.",
                "The probability is the estimator output and is not claimed to be calibrated.",
            ],
        )
