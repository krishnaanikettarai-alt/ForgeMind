"""Source-specific access to ForgeMind's synthetic sensor dataset."""

from __future__ import annotations

import csv
import os
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path


SYNTHETIC_COLUMNS = {
    "machine_id",
    "timestamp",
    "vibration_mm_s",
    "temperature_c",
    "current_a",
}
DEFAULT_DATASET_DIR = Path(__file__).resolve().parents[2] / "public" / "dataset"


class DataError(RuntimeError):
    """Base class for dataset access errors."""


class DataUnavailableError(DataError):
    """Raised when the configured synthetic dataset cannot be read."""


class MachineNotFoundError(DataError):
    """Raised when a synthetic machine ID is not present in the dataset."""


@dataclass(frozen=True)
class SensorReading:
    machine_id: str
    timestamp: str
    vibration_mm_s: float
    temperature_c: float
    current_a: float

    def as_dict(self) -> dict[str, str | float]:
        return {
            "machineId": self.machine_id,
            "timestamp": self.timestamp,
            "vibrationMmS": self.vibration_mm_s,
            "temperatureC": self.temperature_c,
            "currentA": self.current_a,
        }


def dataset_path() -> Path:
    configured = os.getenv("FORGEMIND_DATASET_DIR")
    base = Path(configured).expanduser() if configured else DEFAULT_DATASET_DIR
    return base / "sensor_readings.csv"


def _parse_timestamp(value: str) -> None:
    try:
        datetime.fromisoformat(value)
    except ValueError as exc:
        raise DataUnavailableError(f"Invalid sensor timestamp: {value}") from exc


@lru_cache(maxsize=1)
def _load_readings() -> tuple[SensorReading, ...]:
    path = dataset_path()
    if not path.is_file():
        raise DataUnavailableError(f"Synthetic sensor dataset not found: {path}")

    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if set(reader.fieldnames or ()) != SYNTHETIC_COLUMNS:
                raise DataUnavailableError(
                    "Synthetic sensor dataset has an unexpected schema"
                )
            readings = []
            for line_number, row in enumerate(reader, start=2):
                machine_id = (row.get("machine_id") or "").strip()
                timestamp = (row.get("timestamp") or "").strip()
                if not machine_id or not timestamp:
                    raise DataUnavailableError(
                        f"Missing machine ID or timestamp at CSV line {line_number}"
                    )
                if not machine_id.startswith("M"):
                    raise DataUnavailableError(
                        "Synthetic machine IDs must use the M-prefixed namespace"
                    )
                _parse_timestamp(timestamp)
                try:
                    readings.append(
                        SensorReading(
                            machine_id=machine_id,
                            timestamp=timestamp,
                            vibration_mm_s=float(row["vibration_mm_s"]),
                            temperature_c=float(row["temperature_c"]),
                            current_a=float(row["current_a"]),
                        )
                    )
                except (TypeError, ValueError) as exc:
                    raise DataUnavailableError(
                        f"Invalid numeric sensor value at CSV line {line_number}"
                    ) from exc
    except OSError as exc:
        raise DataUnavailableError(
            f"Unable to read synthetic sensor dataset: {path}"
        ) from exc

    if not readings:
        raise DataUnavailableError("Synthetic sensor dataset is empty")
    return tuple(readings)


def clear_cache() -> None:
    _load_readings.cache_clear()


def machine_ids() -> list[str]:
    return sorted({reading.machine_id for reading in _load_readings()})


def machine_catalog() -> list[dict[str, str | int]]:
    by_machine: dict[str, list[SensorReading]] = {}
    for reading in _load_readings():
        by_machine.setdefault(reading.machine_id, []).append(reading)
    return [
        {
            "machineId": machine_id,
            "source": "synthetic",
            "sensorRows": len(machine_readings),
            "firstTimestamp": machine_readings[0].timestamp,
            "lastTimestamp": machine_readings[-1].timestamp,
        }
        for machine_id, machine_readings in sorted(by_machine.items())
    ]


def machine_sensor_readings(machine_id: str) -> tuple[SensorReading, ...]:
    readings = tuple(
        reading for reading in _load_readings() if reading.machine_id == machine_id
    )
    if not readings:
        raise MachineNotFoundError(f"Synthetic machine not found: {machine_id}")
    return readings


def sensor_readings(machine_id: str, limit: int) -> list[dict[str, str | float]]:
    readings = machine_sensor_readings(machine_id)
    return [reading.as_dict() for reading in readings[-limit:]]
