# Historical failure-risk baseline

This module is a reproducible, supervised baseline over the historical `PdM_*`
CSV files. It is intentionally separate from ForgeMind's synthetic `M01`-`M20`
sensor namespace. Numeric historical machine `17` must never be joined to
synthetic `M17`.

## Setup

From the repository root:

```powershell
& .\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

## Train and evaluate

```powershell
& .\backend\.venv\Scripts\python.exe -m backend.ml.train `
  --dataset-dir .\public\dataset `
  --artifact .\backend\ml\artifacts\historical_failure_baseline.joblib
```

The command sorts telemetry by machine and timestamp, creates current sensor
values plus past-only rolling means, standard deviations, and first differences,
then labels a telemetry row positive when a failure for that same numeric machine
occurs strictly after the timestamp and no later than 24 hours afterward.
The model is a class-weighted logistic-regression pipeline with scaling. The
split is chronological (a timestamp boundary targets a later 20% time period;
one timestamp is never split), never random. JSON output reports the exact date
ranges, class counts, precision,
recall, F1, confusion matrix, and PR-AUC when both classes occur in the test
period.

Generated `.joblib` and metadata artifacts are ignored by Git. Retraining is
the reproducibility mechanism; the artifact contains the fitted preprocessing
and estimator, feature names, label definition, horizon, split dates, metrics,
and model version.

## Inference

`HistoricalFailurePredictor` loads the same fitted pipeline and accepts a
numeric historical ID plus telemetry history:

```python
from backend.ml.predictor import HistoricalFailurePredictor

predictor = HistoricalFailurePredictor(
    "backend/ml/artifacts/historical_failure_baseline.joblib"
)
result = predictor.predict(17, telemetry_history)
```

The structured result contains `machine_id`, the estimator's actual
`predict_proba` value as `risk_score`, `risk_level`, a 24-hour horizon,
`model_version`, `as_of_timestamp`, signals, limitations, and status. The
application policy thresholds are low `<0.33`, medium `0.33-<0.66`, and high
`>=0.66`; they are not validated industrial thresholds and the output is not
claimed to be calibrated.

The separate `POST /api/historical/predict` adapter accepts `machine_id` and
`telemetry_history`. It returns an explicit `unsupported` result for
synthetic `M`-prefixed IDs. The endpoint returns `503` until an artifact has
been trained and `422` for invalid or insufficient historical input.

## Limitations

This is a baseline, not an operational maintenance system. The data has
machine-level and time-series sampling assumptions, the positive class is
rare, and a chronological holdout is only one evaluation period. PR-AUC and
the other reported metrics describe this dataset split; they do not establish
industrial validity, calibration, causal relationships, or safe intervention
thresholds. No prediction is available for synthetic machines without a
separate justified model and feature mapping.
