# ForgeMind Predictive Maintenance

An industrial equipment health and maintenance console built with React, TypeScript, Tailwind CSS v4, Motion, and Lucide.

## Run the dashboard

```sh
npm install
npm run dev
```

The app's canonical project root is this folder. The nested `forgemind-signup` scaffold is kept locally as a backup and is excluded from the Git repository.

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

## AMD agent connection

Copy `.env.example` to `.env.local`, set `VITE_AGENT_API_URL` to your backend endpoint, and restart Vite. The assistant sends a JSON `POST` containing `message`, `machineId`, and `context`; it accepts a JSON `response` or `answer` string. Agent credentials should stay in your backend.

Without that endpoint, the assistant uses clearly labeled demo responses.
