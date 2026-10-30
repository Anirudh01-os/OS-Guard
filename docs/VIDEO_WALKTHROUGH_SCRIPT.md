# OSGuard – video walkthrough plan (Team NOVA) – master file

**Educational project.** OSGuard was built for coursework. It runs on **Windows 11** (build 10.0.26300), uses only synthetic data, and never installs a patch or changes a host.

> **Be honest in the video about scope.** The assignment is titled "Mini Project: Modifying a Small OS Kernel". OSGuard is an OS-*update-management simulator*; it does **not** modify a kernel and is **not** xv6. Person 1's script says this plainly. Do not claim otherwise in the recording or the report – the follow-up session may probe it.

| Member | Admission no. | Script file | Segment (one continuous block) | Target length |
|---|---|---|---|---|
| Person 1 – Anirudh Koppuravuri | 24BCE0490 | `scripts/Person1_Anirudh_Koppuravuri.md` | Intro, OS used, architecture, Operations dashboard + 3D map, Fleet inventory | 4:00 |
| Person 2 – Kalivarapu Prabhas | 24BCE2279 | `scripts/Person2_Kalivarapu_Prabhas.md` | Scoring code, Risk engine page, Research page, native C harness + GDB | 5:15 |
| Person 3 – Barath Sornaraj | 24BCE2599 | `scripts/Person3_Barath_Sornaraj.md` | Simulator code + page, Experiment lab, Analytics, Audit center, tests, conclusion | 7:55 |

Total ≈ 17 minutes (4:00 + 5:15 + 7:55). If your course limits video length, speak a little faster or trim the optional live demos; do not drop a feature from the checklist below without telling the team. Each person finishes their **whole** block before the next person starts; nobody interrupts or interleaves.

## How to record so each person completes their part, then the next begins
**Option A – one session (simplest):** share one screen recording; Person 1 speaks their entire block, says the hand-off line, then passes the microphone/keyboard to Person 2, and so on. Keep the same recording running.
**Option B – three clips:** each person records their own block with their own microphone while following their script, then join the clips in Microsoft Clipchamp in the order 1 → 2 → 3. Start each clip from the state listed under "Starting state". Note the timestamp where each clip begins in the joined video.

## One-time preparation (everyone, before recording)
1. Optional clean start: stop the server and rename `backend\data\osguard.db` to `osguard.db.bak` (do not delete) so "Previous rollouts" and the audit log start empty. It is recreated and re-seeded on start.
2. `cd C:\Users\aniru\OneDrive\Documents\OpenMolBench\OSGuard` then `.\start.ps1` and wait for **"OSGuard running at http://127.0.0.1:8000"**.
3. Open http://127.0.0.1:8000 in the browser at 100–110 % zoom, window maximised. Open VS Code on the `OSGuard` folder with the files named in each script ready in tabs.
4. Keep a PowerShell window in `backend\` and a WSL Ubuntu window in `native\` ready.
5. Close notifications. Do a 10-second microphone test. Speak in your own words – the scripts are guides, not text to read word for word.

## Feature coverage checklist (every feature is covered by exactly one person)
| Feature | Owner |
|---|---|
| Synthetic-data banner, educational purpose, host OS, not-xv6 statement | P1 |
| Architecture, tech stack, repository tour, start-up command | P1 |
| Operations dashboard: stat cards, OS distribution, readiness chart, urgency bands | P1 |
| Outstanding patches, priority queue, "urgent but stuck", recent activity | P1 |
| Interactive 3D map: tilt, proximity highlight, hover tooltip, click-to-inspect, Readiness/Urgency toggle, WebGL fallback | P1 |
| Fleet inventory: search, 4 filters, sort + order, clear, Show more, expandable machine details | P1 |
| Fleet 3D map view with filter dimming; Regenerate synthetic fleet (seed, audited) | P1 |
| Urgency formula, weights, bands, exploited bonus, age saturation (scoring.py) | P2 |
| Compatibility risk vs uncertainty; rules B1–B6, W1–W3; precedence | P2 |
| Risk engine page: sliders, gates, telemetry toggle, validation, Save & recompute, Reset | P2 |
| "Explain a machine": blocked (B1), insufficient evidence (B2/B3), ready | P2 |
| Research & sources page, verification note, comparison table, libraries | P2 |
| Native C harness, cross-check (0 mismatches), real GDB session | P2 |
| simulator.py: failure model, eligibility, canary choice, advance, halt, state machine | P3 |
| Simulator page: scenario, seed, soak, batches (+/−/rebalance), thresholds, 3 toggles, fault injection | P3 |
| Plan rollout / Plan & run, Advance, Abort, Compare with all-at-once, Previous rollouts, metrics, timeline, Recorded decisions | P3 |
| Successful staged rollout; injected-fault halt; abort and invalid transition | P3 |
| Experiment lab (6 scenarios, seed, trials, stored experiments) | P3 |
| Analytics (comparison cards, exposure curve, table, caveats) | P3 |
| Audit center: filters, search, expand, export CSV/JSON, paging | P3 |
| Tests (56 + 12), build, defect found and fixed, limitations, conclusion | P3 |

## Hand-off lines
- P1 → P2: "That covers the platform and the fleet. Prabhas will now explain how the risk engine decides what is safe."
- P2 → P3: "That is how a machine is judged ready or blocked. Barath will now show what happens when those machines are rolled out, and how we measure it."
- P3 closes the video.

## Starting state for each block
- **P1:** browser on `#/dashboard`, nothing selected.
- **P2:** browser on `#/risk`; scoring configuration at defaults (P2 must press **Reset to defaults** at the end of the block so P3's numbers match).
- **P3:** browser on `#/simulator`; scoring at defaults; fleet seed 2026.

## After recording
1. Upload to **Microsoft Clipchamp / Google Drive** and share with `manoov.r@vit.ac.in` (as given in the assignment), **or** to **YouTube with visibility Unlisted**. Open the link in a private window to confirm it plays.
2. Fill in the timestamp table below and paste the link on the report's title page and in Section 14.

| Team member | Admission no. | Timestamp range (fill in) |
|---|---|---|
| Anirudh Koppuravuri | 24BCE0490 | [mm:ss – mm:ss] |
| Kalivarapu Prabhas | 24BCE2279 | [mm:ss – mm:ss] |
| Barath Sornaraj | 24BCE2599 | [mm:ss – mm:ss] |

Video link: [paste after upload]

## Follow-up session: every member should know these
1. **Is this xv6 or a kernel modification?** No. It is a Python/FastAPI + React app on Windows 11 that simulates OS-update decisions; the C file is only a GDB demo harness.
2. **Why separate urgency, risk and uncertainty?** Different questions: how much we want the patch, what evidence says it will fail, and what evidence is missing.
3. **What if a mandatory check is missing?** Rule B2 → insufficient evidence → deferred. Never "ready".
4. **What halts a rollout?** Any canary failure (default) or >10 % unhealthy in a batch; unhealthy machines are rolled back and later batches untouched.
5. **Why is staged exposure higher?** Deferred machines stay unpatched and batches take time – the cost of safety.
6. **Does this prove staging works in real life?** No; the failure model links failures to recorded evidence, so it demonstrates the mechanism on synthetic data only.
7. **How are results reproducible?** Seed 2026; hidden outcomes are SHA-256-derived from (seed, machine, patch).
8. **What bug did you fix?** An intermittent HTTP 500 from an SQLite connection crossing threads; fixed with `check_same_thread=False` and a regression test.
9. **Where does GDB fit?** Only the C harness that cross-checks the Python rules; Python/TypeScript are not GDB-debugged.
10. **Why not replace Windows Update / Patch Manager / GKE tooling?** They deploy updates with vendor data; OSGuard only simulates decision logic.
