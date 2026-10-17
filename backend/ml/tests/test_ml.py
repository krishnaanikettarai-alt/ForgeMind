from pathlib import Path

import joblib
import pandas as pd
import pytest
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from backend.ml.features import build_features, build_labels, feature_columns
from backend.ml.model import chronological_split
from backend.ml.predictor import HistoricalFailurePredictor, PredictionError


def telemetry() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "datetime": pd.date_range("2025-01-01", periods=5, freq="h"),
            "machineID": [1] * 5,
            "volt": [1, 2, 3, 4, 5],
            "rotate": [2, 2, 2, 2, 2],
            "pressure": [3, 3, 3, 3, 3],
            "vibration": [4, 5, 6, 7, 8],
        }
    )


def test_features_are_sorted_and_past_only() -> None:
    frame = telemetry().iloc[[2, 0, 1, 4, 3]]
    result = build_features(frame, rolling_window=3)
    assert result["datetime"].is_monotonic_increasing
    assert result.loc[2, "volt_rolling_mean"] == 2.0
    assert result.loc[2, "volt_trend"] == 1.0


def test_label_horizon_boundaries() -> None:
    failures = pd.DataFrame(
        {
            "datetime": ["2025-01-01 01:00:00", "2025-01-02 04:00:00"],
            "machineID": [1, 1],
        }
    )
    labels = build_labels(telemetry(), failures, horizon_hours=24)
    assert labels.tolist() == [1, 0, 0, 0, 1]


def test_chronological_split() -> None:
    frame = build_features(telemetry())
    frame["target"] = [0, 0, 0, 1, 1]
    split = chronological_split(frame, test_fraction=0.4)
    assert split.train["datetime"].max() < split.test["datetime"].min()
    assert split.test_start == str(split.test["datetime"].min())


def tiny_artifact(path: Path) -> Path:
    features = build_features(telemetry())
    names = feature_columns(features)
    model = Pipeline(
        [("scale", StandardScaler()), ("classifier", LogisticRegression())]
    )
    model.fit(features[names], [0, 0, 1, 1, 1])
    joblib.dump(
        {
            "model": model,
            "feature_names": names,
            "rolling_window": 3,
            "horizon_hours": 24,
            "model_version": "test-v1",
            "minimum_history": 2,
        },
        path,
    )
    return path


def test_artifact_loading_output_schema_and_probability(tmp_path: Path) -> None:
    predictor = HistoricalFailurePredictor(tiny_artifact(tmp_path / "model.joblib"))
    result = predictor.predict(1, telemetry())
    payload = result.as_dict()
    assert set(payload) >= {
        "machine_id", "risk_score", "risk_level", "prediction_horizon_hours",
        "model_version", "as_of_timestamp", "signals", "limitations", "status",
    }
    assert 0.0 <= payload["risk_score"] <= 1.0
    assert payload["status"] == "available"


def test_unknown_and_insufficient_ids(tmp_path: Path) -> None:
    predictor = HistoricalFailurePredictor(tiny_artifact(tmp_path / "model.joblib"))
    with pytest.raises(PredictionError):
        predictor.predict(99, telemetry())
    with pytest.raises(PredictionError):
        predictor.predict(1, telemetry().iloc[:1])


def test_synthetic_id_is_explicitly_unsupported(tmp_path: Path) -> None:
    predictor = HistoricalFailurePredictor(tiny_artifact(tmp_path / "model.joblib"))
    result = predictor.predict("M17", telemetry())
    assert result.status == "unsupported"
    assert result.risk_score is None
