# OSGuard algorithm definitions

Everything below is deterministic rules and arithmetic. **There is no machine learning.** All inputs are synthetic.
Source of truth: `backend/osguard/scoring.py`, `simulator.py`, `analytics.py`, `scenarios.py`.

## 1. Urgency score (0–100)

For machine *m* and its pending patch *p*, with normalised weights `wᵢ = Wᵢ / ΣW`:

| factor | value in 0..1 | default W |
|---|---|---|
| severity | `min(1, CVSS/10 + exploited_bonus·[known_exploited])` | 0.40 |
| exposure | internet 1.0 · internal 0.5 · isolated 0.2 (configurable) | 0.25 |
| criticality | `(criticality − 1) / 4` | 0.15 |
| patch age | `min(1, days_since_fix_released / age_saturation_days)` (default 60) | 0.20 |

`urgency = 100 · Σ wᵢ · factorᵢ`. Bands (configurable): critical ≥ 70, high ≥ 55, medium ≥ 35, else low.
Each factor's contribution in points is returned and shown in the UI.

## 2. Compatibility risk vs. uncertainty (tracked separately)

Check weights: mandatory checks (`driver_compat`, `app_compat`, `backup_verified`) = 1.0, optional (`agent_compat`, `disk_space`) = 0.5, telemetry = 1.5.

* **compatibility risk** = weight of checks with result `fail` ÷ weight of all checks (negative evidence).
* **uncertainty** = weight of checks with result `unknown` (+ telemetry weight if telemetry is absent) ÷ total weight (missing evidence).

A missing result is **never** counted as a pass.

## 3. Deployment readiness (rules, not a score)

| code | meaning | class |
|---|---|---|
| B1 | a mandatory check failed | negative evidence |
| B2 | a mandatory check has no result | missing evidence |
| B3 | no health telemetry (when `require_telemetry`) | missing evidence |
| B4 | vendor/safeguard hold for this OS version | negative evidence |
| B5 | pre-update latency ratio or error rate over limit | negative evidence |
| B6 | family requires manual approval (default: ICS/Embedded) | approval gate |
| W1–W3 | optional check failed/unknown, telemetry optional-but-missing | warning |

Precedence: any negative evidence → `blocked`; else any missing evidence → `insufficient_evidence`; else B6 → `needs_approval`; else warnings or `uncertainty ≥ caution_uncertainty` → `ready_with_caution`; else `ready`. Compliant machines are out of scope.

Recommended action: ready → `deploy_staged` (or `deploy_expedited` if urgency is critical); blocked/insufficient and critical urgency → `escalate_mitigate` (human + compensating controls); otherwise `resolve_blockers`, `collect_evidence` or `request_approval`. Every assessment lists the rules and numbers that produced it.

## 4. Rollout simulation

**Staged strategy.** Eligible = `ready` (+ `ready_with_caution` if allowed). Ineligible machines are *deferred* and each deferral is recorded with its rule codes. Eligible machines are ordered by (criticality ↑, caution last, urgency ↓). The canary is picked round-robin across OS families from the front of that order; remaining batches follow it. Batch sizes come from `batch_percents` (sum must be 100, 1–8 batches, canary ≥ 1 machine).

Per batch: deploy (`base + ceil(n/concurrency)·minutes_per_wave`) → soak → health evaluation. A machine is *unhealthy* if unreachable, `latency/baseline > max_latency_ratio`, or `error_rate > max_error_rate`; with no telemetry it is *unverifiable* and — fail-closed by default — counted unhealthy. The batch **halts** the rollout if the canary has any unhealthy machine (configurable) or `unhealthy/n > max_unhealthy_fraction`. Unhealthy machines are rolled back; later batches are marked `skipped` and never touched.

**Baseline.** All in-scope machines in one wave, no readiness gate, no soak, no halt. Failures are noticed manually after `baseline_detect_minutes`, then rolled back.

**State machine.** `planned → running → {completed | halted | aborted}`; `planned → aborted`. Anything else raises `InvalidTransition` (HTTP 409).

## 5. Failure model (the simulation’s hidden truth)

Per machine, independent probabilities are combined as `p = 1 − Π(1 − pᵢ)`, capped at 0.97:

background `base_failure_probability` (0.01) · failed driver check 0.55 · failed app check 0.45 · each unknown mandatory check 0.08 · pre-existing degradation 0.30 · vendor hold 0.50 · each matching injected fault’s probability.

The machine fails iff `unit(seed, "fail", machine, patch) < p`, where `unit` is a SHA-256-derived uniform value. Both strategies therefore see **identical truth** for a given seed. 15 % of non-boot failures are *subtle regressions* that stay under the default thresholds and are reported as `undetected_degraded` — the health gate cannot see them.

## 6. Metrics

| metric | definition |
|---|---|
| failure blast radius | deployed machines whose hidden outcome is *fail* (also criticality-weighted) |
| completion time | simulated minute at which the rollout stopped (incl. rollbacks); plus fraction of fleet patched |
| simulated unpatched exposure | `Σ (urgency/100) · hours unprotected` over `horizon_hours` (default 168); rolled-back, deferred and skipped machines stay exposed |
| unnecessary delays | machines deferred by the gate or skipped after a halt whose hidden outcome was *success* |
| safety-rule violations | deployments to a machine with an unmet blocker (B1–B6), critical machine in canary (V7), or a breach with no ability to halt (V8, baseline only) |

Experiments run `trials` outcome seeds (`seed … seed+trials−1`) and report mean and [min–max].

## 7. Why the results favour gating (read this)

The failure model *correlates* hidden failures with recorded evidence (failed checks raise failure probability), so evidence-gating reduces blast radius **by construction**. Injected-fault and subtle-regression scenarios show the limits (failures no check predicts), but real-world fleets can behave differently from any model written by the same author. Results demonstrate the mechanism and its trade-offs — notably higher simulated exposure and unnecessary delays for the staged strategy — and are not evidence of real-world benefit.
