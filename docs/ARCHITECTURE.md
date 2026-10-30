# OSGuard architecture

```
 Browser (React + TS + Vite)                         FastAPI (Python)                       SQLite
┌──────────────────────────────┐   /api/*  JSON   ┌───────────────────────────────┐   ┌──────────────────┐
│ Views: Operations · Fleet ·  │ ───────────────▶ │ api.py  (validation, HTTP     │   │ machines, patches│
│ Risk · Simulator · Lab ·     │                  │          status mapping)      │──▶│ settings (scoring)│
│ Analytics · Audit · Research │ ◀─────────────── │                               │   │ rollouts (state) │
│                              │                  │ pure engine modules           │   │ experiments      │
│ 3D map (R3F, lazy chunk)     │                  │  fleet.py     seed → fleet    │   │ audit_events     │
│ SVG fallback if no WebGL     │                  │  scoring.py   urgency/readiness│  └──────────────────┘
│ lib/: api, validation,       │                  │  simulator.py plan/advance/halt│
│       layout, format (tested)│                  │  scenarios.py scenario rewrites│
└──────────────────────────────┘                  │  analytics.py metrics          │
                                                  │  experiments.py multi-trial    │
                                                  │  db.py        persistence+audit│
                                                  └───────────────────────────────┘
```

## Principles

* **Pure engine, thin API.** `scoring`, `simulator`, `analytics` and `experiments` take plain models and return plain models — no I/O — so they are unit-tested directly (`backend/tests`). `api.py` only loads data, calls the engine, persists and maps errors (`InvalidTransition` → 409, validation → 422, unknown id → 404).
* **Never mutate the inventory for an experiment.** Scenarios rewrite deep copies. Stored machines change only through `POST /api/fleet/reseed` (audited).
* **Rollouts are resumable.** A rollout is a serialisable `RolloutState` stored as JSON; each `advance` reloads it, reapplies the scenario deterministically, runs one batch and saves. Only events not yet written are appended to the audit log (`persisted_events` cursor), so nothing is logged twice.
* **Deterministic outcomes.** Hidden per-machine truth is `sha256(seed|…)`-derived, independent of Python hash randomisation, process restarts and strategy.
* **Fail closed.** Missing mandatory evidence, missing telemetry or an unverifiable machine blocks or halts; it is never rounded up to “safe”.
* **Safe by construction.** No code path shells out, touches the OS, or installs anything. The only I/O is SQLite and HTTP.

## Data model (SQLite)

| table | purpose |
|---|---|
| `machines`, `patches` | synthetic inventory/catalogue (JSON documents) |
| `settings` | scoring configuration, fleet seed metadata |
| `rollouts` | one row per simulated rollout, full `RolloutState` JSON, status |
| `experiments` | multi-trial scenario results (summary, representative run, per-trial metrics) |
| `audit_events` | UTC timestamp, category, action, subject, rule, detail JSON, rollout/experiment ids, simulated minute |

## API summary

`GET /api/health · /dashboard · /fleet (search, filters, sort) · /fleet/{id} · /patches · /scenarios · /analytics · /sources`
`POST /api/fleet/reseed · /rollouts · /rollouts/{id}/advance · /rollouts/{id}/abort · /experiments`
`GET/PUT /api/config/scoring · POST /api/config/scoring/reset · GET /api/rollouts[/{id}] · /experiments[/{id}] · /audit · /audit/export?format=csv|json`
Interactive docs: `http://127.0.0.1:8000/docs`.

## Frontend notes

* Hash routing (`#/fleet`), no router dependency. Charts: Recharts. Motion: Framer Motion (honours `prefers-reduced-motion`; magnetic buttons and page transitions are disabled/shortened, the 3D scene stops auto-rotation and parallax).
* `Fleet3D` renders all machines as one `InstancedMesh` with per-instance colour/scale, animated edge pulses, pointer-driven tilt and screen-space proximity highlighting. It lives in its own lazy chunk; `FleetMap` falls back to an accessible SVG map when WebGL is unavailable or the scene throws.
