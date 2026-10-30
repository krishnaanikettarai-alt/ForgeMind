# ForgeMind Predictive Maintenance

An industrial equipment health and maintenance console built with React, TypeScript, Tailwind CSS v4, Motion, and Lucide.

## Run the dashboard

```sh
npm install
npm run dev
```

The app's canonical project root is this folder. The nested `forgemind-signup` scaffold is kept locally as a backup and is excluded from the Git repository.

## Run the backend

From the repository root, create a Python environment and install the backend dependencies:

```powershell
python -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Copy-Item .env.example .env
```

Add your NVIDIA API key to `.env`, then start the API:

```powershell
backend\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

Run the dashboard and backend in separate terminals from the repository root. `VITE_AGENT_API_URL` in `.env` points the browser to the local API.

## Included datasets

Files in `public/dataset/` are served by Vite and copied into production builds:

| File | Records | Purpose |
| --- | ---: | --- |
| `sensor_readings.csv` | 100,000 | Minute-level vibration, temperature, and current samples for 20 assets |
| `PdM_machines.csv` | 100 | Machine model and age metadata |
| `PdM_telemetry.csv` | 876,100 | Historical voltage, rotation, pressure, and vibration telemetry |
| `PdM_maint.csv` | 3,286 | Historical maintenance events |
| `PdM_failures.csv` | 761 | Historical component failures |
| `PdM_errors.csv` | 3,919 | Historical error events |

The dashboard's data view links to each source file. The historical Microsoft PdM data and the newer synthetic sensor file use different time ranges and machine identifiers; they are kept as separate sources rather than silently merged.

## NVIDIA NIM agent connection

The assistant uses NVIDIA NIM's OpenAI-compatible chat completions API. Create an API key in the [NVIDIA API Catalog](https://build.nvidia.com/), copy `.env.example` to the repository-root `.env`, and set `NVIDIA_API_KEY`. Set `FORGEMIND_NVIDIA_MODEL` to a model ID enabled for your key; the default is `nvidia/llama-3.3-nemotron-super-49b-v1`. For a self-hosted NIM service, set `FORGEMIND_NVIDIA_BASE_URL` to its OpenAI-compatible `/v1` endpoint.

Keep the NVIDIA key in the backend environment; never put it in a `VITE_` variable or frontend source. The browser talks to FastAPI through `VITE_AGENT_API_URL`. The assistant sends JSON with `message`, `machineId`, and `context`; it accepts a JSON `response` or `answer` string.

Without that endpoint, the assistant uses clearly labeled demo responses.
