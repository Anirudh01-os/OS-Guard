"""Rollout simulator: staged (canary → batches, health-gated) vs. all-at-once baseline.

Nothing here touches a real system. "Outcomes" are produced by a documented probabilistic
failure model keyed by a hash of (seed, machine, patch), so both strategies see exactly the
same latent truth for a given seed – only their *decisions* differ.
"""
from __future__ import annotations

import hashlib
import math

from .models import (
    BatchPlan,
    BatchResult,
    Deferred,
    FaultKind,
    Machine,
    MachineResult,
    Assessment,
    Patch,
    RolloutConfig,
    RolloutEvent,
    RolloutState,
    ScoringConfig,
)
from .scoring import DEPLOYABLE

ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "planned": {"running", "aborted"},
    "running": {"running", "completed", "halted", "aborted"},
    "completed": set(),
    "halted": set(),
    "aborted": set(),
}
TERMINAL = {"completed", "halted", "aborted"}

# Failure-model constants (documented in docs/ALGORITHMS.md).
P_DRIVER_FAIL = 0.55
P_APP_FAIL = 0.45
P_UNKNOWN_MANDATORY = 0.08
P_PRE_DEGRADED = 0.30
P_VENDOR_HOLD = 0.50
P_SUBTLE = 0.15  # fraction of non-boot failures that stay under the health thresholds


class InvalidTransition(Exception):
    pass


def unit(seed: int, *parts: object) -> float:
    """Deterministic uniform [0,1) from a hash – independent of Python's hash randomisation."""
    h = hashlib.sha256(("|".join(str(p) for p in (seed, *parts))).encode()).digest()
    return int.from_bytes(h[:8], "big") / 2**64


# --------------------------------------------------------------------------- failure model


def failure_model(m: Machine, patch: Patch, cfg: RolloutConfig, scoring: ScoringConfig, seed: int) -> tuple[bool, FaultKind | None]:
    """Return (fails, kind) – the simulation's hidden ground truth for this machine."""
    parts: list[tuple[float, FaultKind]] = [(cfg.base_failure_probability, "latency_regression")]
    if m.checks.get("driver_compat") == "fail":
        parts.append((P_DRIVER_FAIL, "boot_failure"))
    if m.checks.get("app_compat") == "fail":
        parts.append((P_APP_FAIL, "error_spike"))
    unknown = sum(1 for c in ("driver_compat", "app_compat", "backup_verified") if m.checks.get(c) == "unknown")
    if unknown:
        parts.append((1 - (1 - P_UNKNOWN_MANDATORY) ** unknown, "latency_regression"))
    h = m.health
    if h.latency_ratio > scoring.health_latency_ratio_max or h.error_rate > scoring.health_error_rate_max:
        parts.append((P_PRE_DEGRADED, "latency_regression"))
    if m.os_version in patch.hold_versions:
        parts.append((P_VENDOR_HOLD, "boot_failure"))
    for f in cfg.faults:
        if f.matches(m):
            parts.append((f.probability, f.kind))
    survive = 1.0
    for p, _ in parts:
        survive *= 1 - min(max(p, 0.0), 1.0)
    p_fail = min(0.97, 1 - survive)
    if unit(seed, "fail", m.id, patch.id) >= p_fail:
        return False, None
    kind = max(parts, key=lambda t: t[0])[1]
    if kind != "boot_failure" and unit(seed, "subtle", m.id) < P_SUBTLE:
        kind = "subtle_regression"
    return True, kind


def post_update_health(m: Machine, fails: bool, kind: FaultKind | None, seed: int) -> tuple[float | None, float]:
    """(latency_ms or None if unreachable, error_rate) observed after the simulated update."""
    base = m.health.baseline_latency_ms
    j = lambda tag, lo, hi: lo + (hi - lo) * unit(seed, tag, m.id)  # noqa: E731
    if not fails:
        return m.health.latency_ms * j("jl", 1.0, 1.12), m.health.error_rate * j("je", 1.0, 1.2)
    if kind == "boot_failure":
        return None, 1.0
    if kind == "latency_regression":
        return base * j("jl", 2.2, 4.0), m.health.error_rate * 1.5
    if kind == "error_spike":
        return m.health.latency_ms * 1.1, j("je", 0.06, 0.2)
    return base * j("jl", 1.2, 1.4), j("je", 0.015, 0.025)  # subtle_regression


def is_unhealthy(m: Machine, latency: float | None, error: float, cfg: RolloutConfig) -> bool:
    if latency is None:
        return True
    return latency / m.health.baseline_latency_ms > cfg.max_latency_ratio or error > cfg.max_error_rate


# --------------------------------------------------------------------------- planning


def _emit(state: RolloutState, minute: float, kind: str, message: str, *, batch: int | None = None,
          machine_id: str | None = None, rule: str | None = None, **data: object) -> RolloutEvent:
    ev = RolloutEvent(seq=len(state.events), minute=round(minute, 2), kind=kind, batch=batch,
                      machine_id=machine_id, rule=rule, message=message, data=dict(data))
    state.events.append(ev)
    return ev


def _split_sizes(n: int, percents: list[float]) -> list[int]:
    """Convert percentages to non-empty integer batch sizes summing to n."""
    if n == 0:
        return []
    total = sum(percents)
    bounds, acc = [], 0.0
    for p in percents:
        acc += p
        bounds.append(round(n * acc / total))
    bounds[-1] = n
    sizes, prev = [], 0
    for b in bounds:
        sizes.append(max(b - prev, 0))
        prev = b
    if sizes[0] == 0:  # always have a real canary
        sizes[0] = 1
        for i in range(1, len(sizes)):
            if sizes[i] > 0:
                sizes[i] -= 1
                break
    return [s for s in sizes if s > 0]


def _select_canary(ordered: list[Machine], size: int) -> list[Machine]:
    """Round-robin across OS families so the canary covers as many platforms as possible."""
    groups: dict[str, list[Machine]] = {}
    for m in ordered:
        groups.setdefault(m.os_family, []).append(m)
    chosen: list[Machine] = []
    while len(chosen) < size and any(groups.values()):
        for fam in sorted(groups):
            if groups[fam] and len(chosen) < size:
                chosen.append(groups[fam].pop(0))
    return chosen


def plan_rollout(
    machines: list[Machine],
    patches: dict[str, Patch],
    assessments: dict[str, Assessment],
    cfg: RolloutConfig,
    scoring: ScoringConfig,
    *,
    scenario_id: str = "none",
    seed: int = 2026,
) -> RolloutState:
    state = RolloutState(strategy=cfg.strategy, scenario_id=scenario_id, seed=seed, config=cfg)
    scope = [m for m in machines if m.patch_status == "pending"]
    for m in scope:
        fails, kind = failure_model(m, patches[m.patch_id], cfg, scoring, seed)
        state.results[m.id] = MachineResult(machine_id=m.id, failed=fails, fault_kind=kind, would_succeed=not fails)

    if cfg.strategy == "all_at_once":
        ids = sorted(m.id for m in scope)
        state.batches = [BatchPlan(index=0, label="All at once", machine_ids=ids)] if ids else []
        _emit(state, 0, "PLAN", f"Baseline: deploy to all {len(ids)} in-scope machines simultaneously. "
              "No readiness gate, no health gate, no halt.", rule="BASELINE")
        return state

    eligible: list[Machine] = []
    for m in scope:
        a = assessments[m.id]
        ok = a.readiness in DEPLOYABLE and (cfg.allow_caution or a.readiness == "ready")
        if ok:
            eligible.append(m)
            continue
        codes = list(dict.fromkeys(b.code for b in a.blockers)) or ["POLICY_NO_CAUTION"]
        state.deferred.append(Deferred(machine_id=m.id, readiness=a.readiness, codes=codes))
        state.results[m.id].state = "deferred"
        _emit(state, 0, "MACHINE_DEFERRED", f"{m.id} deferred ({a.readiness}): {'; '.join(codes)}",
              machine_id=m.id, rule=codes[0], readiness=a.readiness, codes=codes)

    ordered = sorted(eligible, key=lambda m: (m.criticality, assessments[m.id].readiness != "ready", -assessments[m.id].urgency.score, m.id))
    sizes = _split_sizes(len(ordered), cfg.batch_percents)
    if sizes:
        canary = _select_canary(ordered, sizes[0])
        chosen = {m.id for m in canary}
        rest = [m for m in ordered if m.id not in chosen]
        groups = [canary]
        pos = 0
        for s in sizes[1:]:
            groups.append(rest[pos:pos + s])
            pos += s
        for i, g in enumerate(groups):
            state.batches.append(BatchPlan(index=i, label="Canary" if i == 0 else f"Stage {i}", machine_ids=[m.id for m in g]))
    _emit(state, 0, "PLAN",
          f"Staged plan: {len(ordered)} eligible machines in {len(state.batches)} batches {sizes}; "
          f"{len(state.deferred)} deferred by readiness gate.", rule="STAGED_PLAN",
          eligible=len(ordered), deferred=len(state.deferred), sizes=sizes)
    return state


# --------------------------------------------------------------------------- execution


def advance(
    state: RolloutState,
    machines: dict[str, Machine],
    patches: dict[str, Patch],
    scoring: ScoringConfig,
) -> list[RolloutEvent]:
    """Run the next batch to completion (deploy → soak → health evaluation → decision)."""
    if "running" not in ALLOWED_TRANSITIONS[state.status]:
        raise InvalidTransition(f"cannot advance a rollout in state '{state.status}'")
    first = len(state.events)
    cfg = state.config
    if state.next_batch >= len(state.batches):
        state.status = "completed"
        _emit(state, state.clock, "ROLLOUT_COMPLETED", "Nothing to deploy; rollout closed.", rule="EMPTY")
        return state.events[first:]
    state.status = "running"
    batch = state.batches[state.next_batch]
    start = state.clock
    n = len(batch.machine_ids)
    _emit(state, start, "BATCH_STARTED", f"{batch.label}: deploying to {n} machine(s).", batch=batch.index, rule="BATCH_START", size=n)

    deploy_end = start
    for k, mid in enumerate(batch.machine_ids):
        t = start + cfg.deploy_base_minutes + math.ceil((k + 1) / cfg.concurrency) * cfg.minutes_per_wave
        r = state.results[mid]
        r.state, r.patched_at = "patched", t
        deploy_end = max(deploy_end, t)
        _emit(state, t, "MACHINE_PATCHED", f"{mid} updated (simulated).", batch=batch.index, machine_id=mid)

    unhealthy: list[str] = []
    unverifiable: list[str] = []
    detected_failing: list[str] = []
    for mid in batch.machine_ids:
        m, r = machines[mid], state.results[mid]
        lat, err = post_update_health(m, r.failed, r.fault_kind, state.seed)
        if cfg.strategy == "staged" and not m.telemetry_present:
            unverifiable.append(mid)  # cannot verify health: fail closed unless explicitly disabled
            if cfg.fail_closed_on_missing_telemetry:
                unhealthy.append(mid)
            continue
        if is_unhealthy(m, lat, err, cfg):
            unhealthy.append(mid)
            detected_failing.append(mid)

    if cfg.strategy == "all_at_once":
        # Baseline has no gate: failures surface later through manual detection, then rollback.
        end = deploy_end
        for mid in detected_failing:
            r = state.results[mid]
            det = deploy_end + cfg.baseline_detect_minutes
            r.unhealthy_detected, r.state, r.rolled_back_at = True, "rolled_back", det + cfg.rollback_minutes
            end = max(end, r.rolled_back_at)
            _emit(state, det, "FAILURE_DETECTED", f"{mid} failure noticed manually after {cfg.baseline_detect_minutes} min ({r.fault_kind}).",
                  batch=0, machine_id=mid, rule="MANUAL_DETECTION", fault=r.fault_kind)
            _emit(state, r.rolled_back_at, "MACHINE_ROLLED_BACK", f"{mid} rolled back.", batch=0, machine_id=mid)
        for mid in batch.machine_ids:
            r = state.results[mid]
            if r.failed and r.state == "patched":
                r.state = "undetected_degraded"
        frac = len(detected_failing) / n if n else 0.0
        breach = frac > cfg.max_unhealthy_fraction
        state.breach_seen = breach
        state.batch_results.append(BatchResult(index=0, label=batch.label, start_minute=start, end_minute=end, size=n,
                                               unhealthy=len(detected_failing), unverifiable=len(unverifiable),
                                               unhealthy_fraction=round(frac, 4), passed=not breach,
                                               reason="No halt mechanism: failures handled manually after the fact." if breach else "Within tolerance."))
        _emit(state, end, "ROLLOUT_COMPLETED", f"Baseline wave finished with {len(detected_failing)} failures "
              f"({frac:.0%}); rollout could not be halted.", rule="NO_HALT", unhealthy_fraction=round(frac, 4))
        state.clock, state.next_batch, state.status = end, 1, "completed"
        return state.events[first:]

    eval_at = deploy_end + cfg.soak_minutes
    _emit(state, deploy_end, "SOAK_STARTED", f"{batch.label}: soaking {cfg.soak_minutes} min before health evaluation.", batch=batch.index, rule="SOAK")
    frac = len(unhealthy) / n if n else 0.0
    canary_hit = batch.index == 0 and cfg.canary_halt_on_any_failure and len(unhealthy) > 0
    breach = canary_hit or frac > cfg.max_unhealthy_fraction
    _emit(state, eval_at, "HEALTH_CHECK",
          f"{batch.label}: {len(unhealthy)}/{n} unhealthy ({frac:.0%}), {len(unverifiable)} unverifiable; "
          f"limits: latency x{cfg.max_latency_ratio}, errors {cfg.max_error_rate:.1%}, batch tolerance {cfg.max_unhealthy_fraction:.0%}.",
          batch=batch.index, rule="HEALTH_THRESHOLDS", unhealthy=len(unhealthy), unverifiable=len(unverifiable), fraction=round(frac, 4))

    end = eval_at
    for mid in unhealthy:
        r = state.results[mid]
        r.unhealthy_detected, r.state, r.rolled_back_at = True, "rolled_back", eval_at + cfg.rollback_minutes
        end = max(end, r.rolled_back_at)
        why = "telemetry missing – failing closed" if mid in unverifiable else f"health threshold exceeded ({r.fault_kind})"
        _emit(state, eval_at, "MACHINE_ROLLED_BACK", f"{mid} rolled back: {why}.", batch=batch.index, machine_id=mid,
              rule="FAIL_CLOSED" if mid in unverifiable else "HEALTH_THRESHOLDS")
    for mid in batch.machine_ids:
        r = state.results[mid]
        if r.failed and r.state == "patched":
            r.state = "undetected_degraded"

    if breach:
        reason = (f"Canary failure detected ({len(unhealthy)}/{n} unhealthy)." if canary_hit
                  else f"Unhealthy fraction {frac:.0%} exceeds tolerance {cfg.max_unhealthy_fraction:.0%}.")
        state.batch_results.append(BatchResult(index=batch.index, label=batch.label, start_minute=start, end_minute=end, size=n,
                                               unhealthy=len(unhealthy), unverifiable=len(unverifiable),
                                               unhealthy_fraction=round(frac, 4), passed=False, reason=reason))
        remaining = 0
        for b in state.batches[batch.index + 1:]:
            for mid in b.machine_ids:
                state.results[mid].state = "skipped"
                remaining += 1
        state.status, state.halt_reason, state.breach_seen = "halted", reason, True
        state.clock, state.next_batch = end, batch.index + 1
        _emit(state, end, "ROLLOUT_HALTED", f"HALT after {batch.label}: {reason} {remaining} machine(s) in later batches were NOT touched.",
              batch=batch.index, rule="AUTO_HALT", skipped=remaining)
        return state.events[first:]

    state.batch_results.append(BatchResult(index=batch.index, label=batch.label, start_minute=start, end_minute=end, size=n,
                                           unhealthy=len(unhealthy), unverifiable=len(unverifiable),
                                           unhealthy_fraction=round(frac, 4), passed=True, reason="Within health thresholds; proceed."))
    _emit(state, end, "BATCH_PASSED", f"{batch.label} passed; promoting to next batch." if batch.index + 1 < len(state.batches)
          else f"{batch.label} passed.", batch=batch.index, rule="BATCH_PASS")
    state.clock, state.next_batch = end, batch.index + 1
    if state.next_batch >= len(state.batches):
        state.status = "completed"
        _emit(state, end, "ROLLOUT_COMPLETED", "All batches completed.", rule="COMPLETE")
    return state.events[first:]


def abort(state: RolloutState, reason: str = "operator abort") -> list[RolloutEvent]:
    if "aborted" not in ALLOWED_TRANSITIONS[state.status]:
        raise InvalidTransition(f"cannot abort a rollout in state '{state.status}'")
    first = len(state.events)
    for b in state.batches[state.next_batch:]:
        for mid in b.machine_ids:
            state.results[mid].state = "skipped"
    state.status, state.halt_reason = "aborted", reason
    _emit(state, state.clock, "ROLLOUT_ABORTED", f"Rollout aborted: {reason}.", rule="OPERATOR_ABORT")
    return state.events[first:]


def run_to_end(state: RolloutState, machines: dict[str, Machine], patches: dict[str, Patch], scoring: ScoringConfig) -> RolloutState:
    while state.status not in TERMINAL:
        advance(state, machines, patches, scoring)
    return state
