"""Load the historical PdM CSV namespace."""

from __future__ import annotations

import os
from pathlib import Path

import pandas as pd

DEFAULT_DATASET_DIR = Path(__file__).resolve().parents[2] / "public" / "dataset"


def dataset_dir() -> Path:
    configured = os.getenv("FORGEMIND_DATASET_DIR")
    return Path(configured).expanduser() if configured else DEFAULT_DATASET_DIR


def load_historical_data(
    directory: Path | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    base = directory or dataset_dir()
    telemetry = pd.read_csv(base / "PdM_telemetry.csv")
    failures = pd.read_csv(base / "PdM_failures.csv")
    return telemetry, failures
