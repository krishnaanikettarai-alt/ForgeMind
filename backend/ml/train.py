"""CLI for reproducible historical failure-risk training and evaluation."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib

from .data import load_historical_data
from .features import feature_columns, make_training_frame
from .model import chronological_split, evaluate, make_pipeline


def train(
    dataset_dir: Path | None = None,
    artifact_path: Path = Path("backend/ml/artifacts/historical_failure_baseline.joblib"),
    test_fraction: float = 0.2,
    rolling_window: int = 6,
    horizon_hours: int = 24,
) -> dict:
    telemetry, failures = load_historical_data(dataset_dir)
    frame = make_training_frame(telemetry, failures, rolling_window, horizon_hours)
    names = feature_columns(frame)
    split = chronological_split(
        frame,
        test_fraction=test_fraction,
        horizon_hours=horizon_hours,
    )
    if split.train["target"].nunique() < 2:
        raise ValueError(
            "Training period contains only one target class after the time purge; "
            "use more history or a different evaluation period."
        )
    model = make_pipeline()
    model.fit(split.train[names], split.train["target"])
    metrics = evaluate(model, split.test, names)
    metadata = {
        "model_version": "historical-logistic-v1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "feature_names": names,
        "target_definition": (
            "Recorded failure for the same numeric machine strictly after and "
            f"within {horizon_hours} hours of telemetry timestamp."
        ),
        "horizon_hours": horizon_hours,
        "rolling_window": rolling_window,
        "minimum_history": 2,
        "training_date_range": [split.train["datetime"].min().isoformat(), split.train["datetime"].max().isoformat()],
        "test_date_range": [split.test["datetime"].min().isoformat(), split.test["datetime"].max().isoformat()],
        "split": {
            "test_fraction": test_fraction,
            "label_window_purge_hours": horizon_hours,
            "train_end": split.train_end,
            "test_start": split.test_start,
        },
        "class_counts": {
            "train": {str(int(k)): int(v) for k, v in split.train["target"].value_counts().sort_index().items()},
            "test": metrics["class_counts"],
        },
        "metrics": metrics,
    }
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, **metadata}, artifact_path)
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-dir", type=Path)
    parser.add_argument("--artifact", type=Path, default=Path("backend/ml/artifacts/historical_failure_baseline.joblib"))
    args = parser.parse_args()
    print(json.dumps(train(args.dataset_dir, args.artifact), indent=2, default=str))


if __name__ == "__main__":
    main()
