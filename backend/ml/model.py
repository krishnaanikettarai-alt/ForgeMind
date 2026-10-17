"""Model construction and chronological evaluation."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, confusion_matrix, f1_score, precision_score, recall_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


@dataclass(frozen=True)
class Split:
    train: pd.DataFrame
    test: pd.DataFrame
    train_end: str
    test_start: str
    test_end: str


def chronological_split(frame: pd.DataFrame, test_fraction: float = 0.2) -> Split:
    if not 0 < test_fraction < 1:
        raise ValueError("test_fraction must be between 0 and 1")
    ordered = frame.sort_values("datetime", kind="mergesort").reset_index(drop=True)
    timestamps = ordered["datetime"].drop_duplicates().sort_values().reset_index(drop=True)
    cutoff_position = max(
        1, min(len(timestamps) - 1, int(len(timestamps) * (1 - test_fraction)))
    )
    cutoff = timestamps.iloc[cutoff_position]
    train = ordered[ordered["datetime"] < cutoff].copy()
    test = ordered[ordered["datetime"] >= cutoff].copy()
    if train.empty or test.empty:
        raise ValueError("Chronological split produced an empty train or test set")
    return Split(
        train=train,
        test=test,
        train_end=str(train["datetime"].max()),
        test_start=str(test["datetime"].min()),
        test_end=str(test["datetime"].max()),
    )


def make_pipeline() -> Pipeline:
    return Pipeline(
        [
            ("scaler", StandardScaler()),
            (
                "classifier",
                LogisticRegression(
                    class_weight="balanced",
                    max_iter=1000,
                    solver="liblinear",
                    random_state=42,
                ),
            ),
        ]
    )


def evaluate(model: Pipeline, test: pd.DataFrame, feature_names: list[str]) -> dict[str, Any]:
    actual = test["target"].astype(int)
    predicted = model.predict(test[feature_names]).astype(int)
    probabilities = model.predict_proba(test[feature_names])[:, 1]
    matrix = confusion_matrix(actual, predicted, labels=[0, 1]).tolist()
    metrics: dict[str, Any] = {
        "precision": float(precision_score(actual, predicted, zero_division=0)),
        "recall": float(recall_score(actual, predicted, zero_division=0)),
        "f1": float(f1_score(actual, predicted, zero_division=0)),
        "confusion_matrix_labels": [0, 1],
        "confusion_matrix": matrix,
        "class_counts": {str(int(key)): int(value) for key, value in actual.value_counts().sort_index().items()},
    }
    if actual.nunique() == 2:
        metrics["pr_auc"] = float(average_precision_score(actual, probabilities))
    else:
        metrics["pr_auc"] = None
    return metrics
