# OSGuard — Risk-Aware Operating-System Update Orchestration

An explainable OS-update **risk assessment and rollout simulation** platform. It shows how an organisation could prioritise security patches while limiting compatibility risk and service disruption.

> **Academic prototype.** All machines, patches, vulnerabilities and outcomes are **synthetic**. Results are **simulation outputs, not real-world measurements**. OSGuard never modifies the host OS, installs patches or runs privileged operations, does not replace commercial patch-management tools, and cannot guarantee that any update is safe. It uses deterministic rules — **no machine learning**.

## Quick start (Windows)

Prerequisites: Python 3.11+ and Node.js 18+ on `PATH`.

```powershell
cd OSGuard
.\start.ps1            # first run: creates venv, installs deps, builds the UI, then serves
```

Open **http://127.0.0.1:8000** (API docs at `/docs`). If PowerShell blocks scripts: `powershell -ExecutionPolicy Bypass -File .\start.ps1`, or run `start.bat`.

Hot-reload development (API :8000 + Vite :5173): `.\start.ps1 -Dev` → http://localhost:5173. Force a UI rebuild: `.\start.ps1 -Rebuild`.

### Manual commands

```powershell
# backend
cd backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements-dev.txt
.\.venv\Scripts\python run.py                     # http://127.0.0.1:8000

# frontend (second terminal)
cd frontend
npm install
npm run build                                     # served by the backend from frontend/dist
npm run dev                                       # optional dev server on :5173
```

### Tests and checks

```powershell
cd backend;  .\.venv\Scripts\python -m pytest -q  # scoring, blockers, missing data, batches, halting, audit, metrics, API
cd frontend; npm test                              # vitest: validation, layout, formatting, error mapping
cd frontend; npm run build                         # tsc type-check + production build
```

## What’s inside

| Module | What it does |
|---|---|
| **Operations** | Fleet stats, OS distribution, readiness/urgency charts, outstanding patches, priority queue, “urgent but stuck” list, recent audit activity, and an interactive **3D fleet map** (pointer tilt/parallax, proximity highlighting, click-to-inspect, SVG fallback without WebGL). |
| **Fleet** | 120 deterministic VMs; search, filters, sorting, expandable explainable machine details, 3D map view with filter dimming, audited re-seeding. |
| **Risk engine** | Editable weights/bands/gates (validated, persisted, audited); urgency, compatibility risk and uncertainty are separate; every recommendation lists the rules behind it. |
| **Rollout simulator** | Configurable canary + staged batches, soak, latency/error thresholds, fault injection, step-by-step or run-to-end, automatic halt, recorded decision reasons, all-at-once baseline overlay. Invalid transitions are rejected. |
| **Experiment lab** | Six reproducible scenarios (healthy, compatibility failures, critical vulnerability, missing telemetry, degraded health, injected bad build) × N seeds. |
| **Analytics** | Blast radius, completion time, simulated unpatched exposure, unnecessary delays, safety violations — mean and range, clearly labelled as simulation. |
| **Audit center** | Persisted timestamped events, filter/search, CSV/JSON export. |
| **Research** | Microsoft, AWS, Google Cloud, Apple MDM and CISA ICS comparison with official links, strengths and limitations. |

Documentation: [docs/ALGORITHMS.md](docs/ALGORITHMS.md) (formulas, rules, failure model, metrics) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (diagram, data model, API).

Submission material: [docs/OSGuard_Project_Report.pdf](docs/OSGuard_Project_Report.pdf) / `.docx` (main report, shorter), `OSGuard_Project_Report_full_listings.pdf` / `.docx` (adds complete source listings), [docs/VIDEO_WALKTHROUGH_SCRIPT.md](docs/VIDEO_WALKTHROUGH_SCRIPT.md), and real screenshots in `docs/screenshots/`.

**Native GDB demo (optional, `native/`).** `rollout_gate.c` is a small C diagnostic harness – not part of the app, not a kernel, not xv6 – that re-implements the readiness gate and halt rule and cross-checks the Python verdicts. It was built and debugged in WSL2 Ubuntu (GCC 15.2, GDB 17.1); the real session is in `native/gdb_session.log`. To redo it: from `backend/` run `$env:PYTHONPATH=(Get-Location).Path; .\.venv\Scripts\python ..\native\export_fleet.py ..\native\fleet_export.csv`, then in WSL: `gcc -g -O0 -Wall -Wextra -o /tmp/rollout_gate rollout_gate.c && gdb -q -batch -x gdb_session.gdb --args /tmp/rollout_gate fleet_export.csv`.

## Evaluation methodology

1. Generate the fleet from a seed (default 2026). 2. A scenario rewrites a *copy* and/or injects faults. 3. Each machine’s hidden outcome is a SHA-256-derived uniform value compared with a documented failure probability, so staged and baseline face identical truth. 4. Both strategies run for each of N trial seeds. 5. Metrics are computed from the run, then averaged with [min–max]. 6. The staged strategy is also checked against its own safety rules (must be zero violations); the baseline ignores them by design.

**Measured:** counts/times from these simulations. **Not measured:** anything about real deployments.

## Known limitations

* The failure model correlates failures with recorded evidence, so gating helps *by construction*. Injected faults and “subtle regressions” (which pass default health thresholds) illustrate the limits, but conclusions about real fleets cannot be drawn.
* Staged rollouts show higher simulated exposure and “unnecessary delays” — an honest cost, not a bug.
* Time is a coarse simulated clock; no network, dependency, maintenance-window or reboot-ordering modelling; no retries after rollback.
* The vendor “safeguard hold” and CVSS values are invented; no real CVE data is used.
* Single-user SQLite, no authentication — local use only.
* Apple’s entry links to the general deployment guide because no more specific page was confirmed. Cited pages were fetched and checked on 2026-10-26 (index pages only for Apple and CISA; linked sub-pages and PDFs were not read).

## Troubleshooting

| Symptom | Fix |
|---|---|
| “Cannot reach the OSGuard API” banner | Backend not running – run `.\start.ps1` or `python run.py` in `backend/`. |
| `Address already in use` on 8000 | Another process owns the port: `Get-NetTCPConnection -LocalPort 8000` then stop it, or edit the port in `backend/run.py` (and the Vite proxy in `frontend/vite.config.ts`). |
| `running scripts is disabled` | Use `start.bat` or `powershell -ExecutionPolicy Bypass -File .\start.ps1`. |
| Blank/plain 2D map | WebGL is unavailable or disabled (the fallback is intentional). Enable hardware acceleration. |
| UI looks stale after code changes | `.\start.ps1 -Rebuild` (production) or use `-Dev`. |
| Want a clean database | Stop the server and delete `backend/data/osguard.db`; it is recreated and re-seeded on start. Override the location with `OSGUARD_DB`. |
| `npm install` slow in OneDrive | Move the project outside OneDrive or pause sync. |

## Third-party libraries (all permissive licences)

FastAPI (MIT), Pydantic (MIT), Uvicorn (BSD-3), pytest (MIT), React (MIT), Vite (MIT), Tailwind CSS (MIT), Framer Motion (MIT), Three.js (MIT), @react-three/fiber (MIT), Recharts (MIT), Vitest (MIT). Code, copy and diagrams are original to this project.

