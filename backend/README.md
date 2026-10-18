# ForgeMind backend

Phase 2 provides a FastAPI data API and deterministic analysis over the synthetic sensor dataset. The
historical PdM CSV files use a separate numeric machine-ID namespace and are
not loaded or joined by this backend.

## PowerShell setup

From the repository root:

```powershell
.\backend\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
```

If PowerShell script execution is restricted, invoke the environment directly:

```powershell
& .\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

The install command is provided for environment setup; the repository task
does not install packages automatically.

## Run

From the repository root:

```powershell
& .\backend\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

The API is available at `http://127.0.0.1:8000`.

## Analysis endpoint

`GET /api/machines/{machine_id}/analysis` returns deterministic summaries of
the selected synthetic machine's observed readings:

```text
GET /api/machines/M17/analysis?limit=100&window=10
```

The response includes the source machine ID, observed time range, per-sensor
reading counts, first and last observed values, absolute and percentage
changes, a recent moving average, trend direction, threshold-based flags, and
limitations. `limit` is bounded to 1-1000 readings and `window` is bounded to
1-100 readings. A window larger than the analyzed data returns no moving
average for that metric.

Example response shape:

```json
{
  "machineId": "M17",
  "source": "synthetic",
  "timeRange": {
    "firstTimestamp": "2026-01-04 11:17:00",
    "lastTimestamp": "2026-01-04 11:19:00"
  },
  "analysis": {
    "window": 2,
    "observedMeasurements": {
      "vibration": {
        "readingsAnalyzed": 3,
        "firstObserved": 1.2,
        "lastObserved": 2.1
      }
    },
    "derivedMetrics": {
      "vibration": {
        "absoluteChange": 0.9,
        "percentageChange": 75.0,
        "recentMovingAverage": 1.65,
        "trendDirection": "increasing"
      }
    },
    "thresholdFlags": {
      "vibration": {
        "flagged": false,
        "observedValue": 2.1,
        "threshold": 5.0,
        "comparison": "last observed value >= threshold",
        "source": "application demo default; not industry-validated",
        "status": "unvalidated"
      }
    },
    "thresholds": {
      "vibration": 5.0,
      "temperature": 80.0,
      "current": 30.0,
      "source": "application demo default; not industry-validated",
      "status": "unvalidated"
    }
  },
  "limitations": [
    "Metrics are deterministic summaries of observed sensor readings."
  ]
}
```

Threshold checks flag a sensor when its **last observed value is greater than
or equal to** the configured threshold. The defaults are vibration `5.0`,
temperature `80.0`, and current `30.0`, and are application demonstration
defaults only; they are not industry-standard or operationally validated.
Override them with `FORGEMIND_THRESHOLD_VIBRATION`,
`FORGEMIND_THRESHOLD_TEMPERATURE`, and `FORGEMIND_THRESHOLD_CURRENT`.
Configured values remain marked `unvalidated` in responses.

## Test

From the repository root:

```powershell
& .\backend\.venv\Scripts\python.exe -m pytest backend\tests -q
```

## Configuration

The synthetic dataset is resolved by default at
`public\dataset\sensor_readings.csv` relative to the repository. Override the
directory containing that file with `FORGEMIND_DATASET_DIR`.

`FORGEMIND_CORS_ORIGINS` accepts a comma-separated list of explicit origins.
When unset, only `http://localhost:5173` and `http://127.0.0.1:5173` are
allowed. Do not use a wildcard origin in production.

The assistant endpoint is intentionally a Phase 1 placeholder. It explicitly
reports that the AMD-hosted model and ML predictor are not connected and does
not generate predictions or diagnoses.

## Historical ML baseline

The separate `backend\ml\` module trains a reproducible, leakage-safe
historical predictive-maintenance baseline from the `PdM_*` CSV files. Follow
[`backend\ml\README.md`](ml/README.md) for setup, training, evaluation, and
limitations. After training an artifact, `POST /api/historical/predict`
accepts a numeric historical machine ID and telemetry history. Synthetic
`M01`-`M20` machines remain a separate namespace and receive an explicit
unsupported response.

Analysis does not calculate a trained-model failure probability, health score,
anomaly model, inventory result, supplier comparison, or downtime-cost
estimate. Trend direction and threshold flags are derived only from the
selected observed readings.
