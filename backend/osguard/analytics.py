"""Comparison metrics computed from finished (or halted) simulated rollouts.

Every number produced here is a *simulation output*. It is measured on the synthetic fleet
under the documented failure model and says nothing about real-world outcomes.
"""
from __future__ import annotations

from statistics import mean

from .models import Assessment, Machine, RolloutState

DEPLOYED_STATES = {"patched", "rolled_back", "undetected_degraded"}


def violations(state: RolloutState, machines: dict[str, Machine], assessments: dict[str, Assessment]) -> list[dict]:
    """Safety-rule violations: deploying where the readiness rules said not to."""
    out: list[dict] = []
    for mid, r in state.results.items():
        if r.patched_at is None:
            continue
        a = assessments[mid]
        for b in a.blockers:
            out.append({"machine_id": mid, "rule": b.code, "message": f"Deployed despite: {b.message}"})
        if state.strategy == "staged" and state.batches and mid in state.batches[0].machine_ids and machines[mid].criticality >= 4:
            out.append({"machine_id": mid, "rule": "V7_CRITICAL_IN_CANARY",
                        "message": f"Criticality {machines[mid].criticality} machine placed in the canary batch."})
    if state.strategy == "all_at_once" and state.breach_seen:
        out.append({"machine_id": "*", "rule": "V8_NO_HALT_ON_BREACH",
                    "message": "Health thresholds were breached but the rollout had no mechanism to halt."})
    return out


def _unprotected_hours(r, horizon_min: float) -> list[tuple[float, float]]:
    """Intervals (minutes) during which the machine is not protected by the patch."""
    if r.state in ("patched", "undetected_degraded") and r.patched_at is not None:
        return [(0.0, min(r.patched_at, horizon_min))]
    if r.state == "rolled_back" and r.patched_at is not None and r.rolled_back_at is not None:
        return [(0.0, min(r.patched_at, horizon_min)), (min(r.rolled_back_at, horizon_min), horizon_min)]
    return [(0.0, horizon_min)]


def exposure_curve(state: RolloutState, assessments: dict[str, Assessment], points: int = 28) -> list[dict]:
    horizon = state.config.horizon_hours * 60.0
    res = []
    for k in range(points + 1):
        t = horizon * k / points
        total = 0.0
        for mid, r in state.results.items():
            w = assessments[mid].urgency.score / 100.0
            total += w * sum(max(0.0, min(b, t) - a) for a, b in _unprotected_hours(r, horizon)) / 60.0
        res.append({"hour": round(t / 60.0, 2), "exposure": round(total, 2)})
    return res


def timeline(state: RolloutState) -> list[dict]:
    """Step series: patched / rolled back / degraded-but-live machines over simulated minutes."""
    marks = {0.0}
    for r in state.results.values():
        for t in (r.patched_at, r.rolled_back_at):
            if t is not None:
                marks.add(t)
    series = []
    for t in sorted(marks):
        patched = rolled = impacted = 0
        for r in state.results.values():
            if r.patched_at is not None and r.patched_at <= t:
                if r.rolled_back_at is not None and r.rolled_back_at <= t:
                    rolled += 1
                else:
                    patched += 1
                    if r.failed:
                        impacted += 1
        series.append({"minute": round(t, 2), "patched": patched, "rolled_back": rolled, "impacted": impacted})
    return series


def compute_metrics(state: RolloutState, machines: dict[str, Machine], assessments: dict[str, Assessment]) -> dict:
    cfg = state.config
    horizon = cfg.horizon_hours * 60.0
    scope = list(state.results.values())
    deployed = [r for r in scope if r.patched_at is not None]
    failed_deployed = [r for r in deployed if r.failed]
    blast = len(failed_deployed)
    blast_weighted = sum(machines[r.machine_id].criticality for r in failed_deployed)
    patched_ok = [r for r in scope if r.state in ("patched", "undetected_degraded")]
    would_succeed_unpatched = [r for r in scope if r.state in ("deferred", "skipped") and r.would_succeed]
    exposure = 0.0
    for r in scope:
        w = assessments[r.machine_id].urgency.score / 100.0
        exposure += w * sum(b - a for a, b in _unprotected_hours(r, horizon)) / 60.0
    viol = violations(state, machines, assessments)
    rule_counts: dict[str, int] = {}
    for v in viol:
        rule_counts[v["rule"]] = rule_counts.get(v["rule"], 0) + 1
    gate_delayed = [r for r in scope if r.state == "deferred" and r.would_succeed]
    halt_delayed = [r for r in scope if r.state == "skipped" and r.would_succeed]
    return {
        "strategy": state.strategy,
        "status": state.status,
        "in_scope": len(scope),
        "deployed": len(deployed),
        "deferred_by_gate": sum(1 for r in scope if r.state == "deferred"),
        "skipped_after_halt": sum(1 for r in scope if r.state == "skipped"),
        "patched_successfully": len(patched_ok),
        "completion_fraction": round(len(patched_ok) / len(scope), 4) if scope else 0.0,
        "completion_minutes": round(state.clock, 1),
        "blast_radius": blast,
        "blast_radius_weighted": blast_weighted,
        "blast_radius_fraction": round(blast / len(deployed), 4) if deployed else 0.0,
        "rolled_back": sum(1 for r in scope if r.state == "rolled_back"),
        "undetected_degraded": sum(1 for r in scope if r.state == "undetected_degraded"),
        "unpatched_exposure": round(exposure, 2),
        "unnecessary_delays": len(gate_delayed) + len(halt_delayed),
        "unnecessary_delays_gate": len(gate_delayed),
        "unnecessary_delays_halt": len(halt_delayed),
        "unnecessary_delay_hours": round(len(would_succeed_unpatched) * cfg.horizon_hours, 1),
        "safety_violations": len(viol),
        "safety_violation_rules": rule_counts,
        "halted": state.status == "halted",
        "halt_reason": state.halt_reason,
    }


METRIC_KEYS = [
    "blast_radius", "blast_radius_weighted", "completion_minutes", "completion_fraction", "unpatched_exposure",
    "unnecessary_delays", "safety_violations", "rolled_back", "undetected_degraded", "deployed",
]


def summarise_trials(per_trial: list[dict]) -> dict:
    out = {}
    for k in METRIC_KEYS:
        vals = [t[k] for t in per_trial]
        out[k] = {"mean": round(mean(vals), 3), "min": min(vals), "max": max(vals)}
    out["halted_trials"] = sum(1 for t in per_trial if t["halted"])
    return out
