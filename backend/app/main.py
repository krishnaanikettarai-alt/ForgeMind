"""ForgeMind Phase 1 backend API."""

from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .analysis import analyze_readings, threshold_config
from .data import (
    DataError,
    machine_catalog,
    machine_ids,
    machine_sensor_readings,
    sensor_readings,
)
from backend.ml.predictor import HistoricalFailurePredictor, PredictionError


DEFAULT_ORIGINS = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
}


def allowed_origins() -> list[str]:
    configured = os.getenv("FORGEMIND_CORS_ORIGINS")
    if configured:
        return [origin.strip() for origin in configured.split(",") if origin.strip()]
    return sorted(DEFAULT_ORIGINS)


class AssistantRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=4000)
    machineId: str = Field(min_length=1, max_length=20)
    context: dict[str, Any] | None = None

    @field_validator("message", "machineId")
    @classmethod
    def reject_blank_strings(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class HistoricalPredictionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    machine_id: int | str
    telemetry_history: list[dict[str, Any]] = Field(min_length=1)


def historical_predictor() -> HistoricalFailurePredictor:
    artifact = os.getenv(
        "FORGEMIND_ML_ARTIFACT",
        str(
            os.path.join(
                os.path.dirname(os.path.dirname(__file__)),
                "ml",
                "artifacts",
                "historical_failure_baseline.joblib",
            )
        ),
    )
    return HistoricalFailurePredictor(artifact)


app = FastAPI(title="ForgeMind Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


def ensure_machine_id(machine_id: str) -> None:
    if machine_id not in set(machine_ids()):
        raise HTTPException(
            status_code=404,
            detail=f"Synthetic machine not found: {machine_id}",
        )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/machines")
def get_machines() -> dict[str, list[dict[str, str | int]]]:
    try:
        return {"machines": machine_catalog()}
    except DataError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/machines/{machine_id}/sensors")
def get_machine_sensors(
    machine_id: str,
    limit: int = Query(default=100, ge=1, le=1000),
) -> dict[str, Any]:
    try:
        ensure_machine_id(machine_id)
        return {
            "machineId": machine_id,
            "source": "synthetic",
            "readings": sensor_readings(machine_id, limit),
        }
    except DataError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 503
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@app.get("/api/machines/{machine_id}/analysis")
def get_machine_analysis(
    machine_id: str,
    limit: int = Query(default=100, ge=1, le=1000),
    window: int = Query(default=10, ge=1, le=100),
) -> dict[str, object]:
    try:
        ensure_machine_id(machine_id)
        readings = machine_sensor_readings(machine_id)[-limit:]
        return analyze_readings(
            readings,
            machine_id=machine_id,
            window=window,
            thresholds=threshold_config(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except DataError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 503
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@app.post("/api/assistant")
def assistant(request: AssistantRequest) -> dict[str, str]:
    try:
        ensure_machine_id(request.machineId)
    except DataError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 503
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc

    return {
        "answer": (
            f"Phase 1 assistant response for {request.machineId}: the AMD-hosted "
            "model and ML predictor are not connected yet. No prediction or AI "
            "diagnosis was generated. The backend can provide synthetic sensor "
            "data for the next integration phase."
        )
    }


@app.post("/api/historical/predict")
def historical_prediction(request: HistoricalPredictionRequest) -> dict[str, Any]:
    try:
        return historical_predictor().predict(
            request.machine_id, request.telemetry_history
        ).as_dict()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except PredictionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
