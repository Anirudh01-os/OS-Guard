"""Transparent, configurable patch-risk engine.

Three quantities are tracked *separately* and never folded into one opaque number:

* urgency      – how much we want the patch applied (severity, exposure, criticality, age)
* compat risk  – evidence of NEGATIVE compatibility results (failed checks)
* uncertainty  – MISSING evidence (unknown checks, absent telemetry)

Deployment readiness is decided by explicit rules. A failed mandatory check, a missing
mandatory check, or missing telemetry can only ever *block* a machine, never make it look safe.
"""
from __future__ import annotations

from .models import (
    MANDATORY_CHECKS,
    OPTIONAL_CHECKS,
    Assessment,
    Component,
    Finding,
    Machine,
    Patch,
    ScoringConfig,
    Urgency,
)


def _band(score: float, cfg: ScoringConfig) -> str:
    if score >= cfg.band_critical:
        return "critical"
    if score >= cfg.band_high:
        return "high"
    if score >= cfg.band_medium:
        return "medium"
    return "low"


def compute_urgency(machine: Machine, patch: Patch, cfg: ScoringConfig) -> Urgency:
    total_w = cfg.w_severity + cfg.w_exposure + cfg.w_criticality + cfg.w_age
    sev = min(1.0, patch.cvss / 10.0 + (cfg.exploited_bonus if patch.known_exploited else 0.0))
    exp = cfg.exposure_values[machine.exposure]
    crit = (machine.criticality - 1) / 4.0
    # Patch age = days the fix has been available but not applied.
    age =min(1.0, max(patch.released_days_ago, 0) / cfg.age_saturation_days)
    rows = [
        ("severity", sev, cfg.w_severity,
         f"CVSS {patch.cvss:.1f}" + (f" + {cfg.exploited_bonus:.2f} known-exploited bonus" if patch.known_exploited else "")),
        ("exposure", exp, cfg.w_exposure, f"{machine.exposure} exposure"),
        ("criticality", crit, cfg.w_criticality, f"business criticality {machine.criticality}/5"),
        ("patch_age", age, cfg.w_age,
         f"fix available {patch.released_days_ago} d (saturates at {cfg.age_saturation_days} d)"),
    ]
    comps = [
        Component(name=n, raw=round(r, 4), weight=round(w / total_w, 4), points=round(100 * r * w / total_w, 2), note=note)
        for n, r, w, note in rows
    ]
    score = round(sum(c.points for c in comps), 2)
    return Urgency(score=score, band=_band(score, cfg), components=comps)  # type: ignore[arg-type]


def compute_compat(machine: Machine, cfg: ScoringConfig) -> tuple[float, float]:
    """Return (compatibility_risk, uncertainty), each 0..1."""
    wm, wo, wt = cfg.uncertainty_weight_mandatory, cfg.uncertainty_weight_optional, cfg.uncertainty_weight_telemetry
    total = wm * len(MANDATORY_CHECKS) + wo * len(OPTIONAL_CHECKS) + wt
    failed = unknown = 0.0
    for name, status in machine.checks.items():
        w = wm if name in MANDATORY_CHECKS else wo
        if status == "fail":
            failed += w
        elif status == "unknown":
            unknown += w
    if not machine.telemetry_present:
        unknown += wt
    # Failed evidence is normalised without the telemetry term (telemetry is not a pass/fail check).
    risk_total = wm * len(MANDATORY_CHECKS) + wo * len(OPTIONAL_CHECKS)
    return round(failed / risk_total, 4), round(unknown / total, 4)


def assess_machine(machine: Machine, patch: Patch, cfg: ScoringConfig) -> Assessment:
    urgency = compute_urgency(machine, patch, cfg)
    risk, uncertainty = compute_compat(machine, cfg)

    if machine.patch_status == "compliant":
        return Assessment(
            machine_id=machine.id, urgency=urgency, compatibility_risk=risk, uncertainty=uncertainty,
            readiness="compliant", blockers=[], warnings=[], action="no_action",
            summary="Already compliant with the current patch; nothing to deploy.",
            reasons=["R00 patch_status is compliant – excluded from rollout scope."],
        )

    blockers: list[Finding] = []
    warnings: list[Finding] = []
    negative: list[str] = []  # codes that are *negative* evidence
    missing: list[str] = []  # codes that are *absent* evidence

    for name in MANDATORY_CHECKS:
        st = machine.checks.get(name, "unknown")
        if st == "fail":
            blockers.append(Finding(code="B1_MANDATORY_CHECK_FAILED", message=f"Mandatory check '{name}' failed."))
            negative.append("B1")
        elif st == "unknown":
            blockers.append(Finding(code="B2_MISSING_REQUIRED_EVIDENCE",
                                    message=f"Mandatory check '{name}' has no result; absence of evidence is treated as NOT safe."))
            missing.append("B2")
    if cfg.require_telemetry and not machine.telemetry_present:
        blockers.append(Finding(code="B3_NO_TELEMETRY",
                                message="No health telemetry: post-update health cannot be verified, so rollout is not permitted."))
        missing.append("B3")
    if machine.os_version in patch.hold_versions:
        blockers.append(Finding(code="B4_VENDOR_HOLD", message=patch.hold_reason or "Vendor safeguard hold applies."))
        negative.append("B4")
    h = machine.health
    if h.latency_ratio > cfg.health_latency_ratio_max or h.error_rate > cfg.health_error_rate_max:
        blockers.append(Finding(
            code="B5_PRE_UPDATE_HEALTH_DEGRADED",
            message=f"Machine already unhealthy (latency x{h.latency_ratio:.2f} vs limit x{cfg.health_latency_ratio_max:.2f}, "
                    f"errors {h.error_rate:.1%} vs limit {cfg.health_error_rate_max:.1%}); a regression would be unattributable."))
        negative.append("B5")
    needs_approval = machine.os_family in cfg.manual_approval_families
    if needs_approval:
        blockers.append(Finding(code="B6_MANUAL_APPROVAL_REQUIRED",
                                message=f"{machine.os_family} changes require explicit human/vendor approval."))

    for name in OPTIONAL_CHECKS:
        st = machine.checks.get(name, "unknown")
        if st == "fail":
            warnings.append(Finding(code="W1_OPTIONAL_CHECK_FAILED", message=f"Optional check '{name}' failed."))
        elif st == "unknown":
            warnings.append(Finding(code="W2_OPTIONAL_CHECK_UNKNOWN", message=f"Optional check '{name}' has no result."))
    if not cfg.require_telemetry and not machine.telemetry_present:
        warnings.append(Finding(code="W3_TELEMETRY_OPTIONAL", message="Telemetry missing but policy does not require it; staged rollouts will fail closed."))

    soft_blockers = [b for b in blockers if b.code == "B6_MANUAL_APPROVAL_REQUIRED"]
    hard = [b for b in blockers if b not in soft_blockers]

    # Precedence: negative evidence > missing evidence > approval gate > caution > ready
    if negative:
        readiness = "blocked"
    elif missing:
        readiness = "insufficient_evidence"
    elif hard:  # pragma: no cover - defensive; all hard blockers are classified above
        readiness = "blocked"
    elif soft_blockers:
        readiness = "needs_approval"
    elif warnings or uncertainty >= cfg.caution_uncertainty:
        readiness = "ready_with_caution"
    else:
        readiness = "ready"

    critical = urgency.band == "critical"
    if readiness == "ready":
        action = "deploy_expedited" if critical else "deploy_staged"
    elif readiness == "ready_with_caution":
        action = "deploy_expedited" if critical else "deploy_staged_caution"
    elif readiness == "needs_approval":
        action = "request_approval"
    elif readiness == "insufficient_evidence":
        action = "escalate_mitigate" if critical else "collect_evidence"
    else:
        action = "escalate_mitigate" if critical else "resolve_blockers"

    reasons = [
        f"R01 urgency {urgency.score:.1f}/100 ({urgency.band}): "
        + ", ".join(f"{c.name} {c.points:.1f} pts" for c in urgency.components),
        f"R02 compatibility risk {risk:.0%} (failed evidence) and uncertainty {uncertainty:.0%} (missing evidence) are tracked separately.",
    ]
    reasons += [f"{b.code}: {b.message}" for b in blockers]
    reasons += [f"{w.code}: {w.message}" for w in warnings]

    summaries = {
        "deploy_expedited": "Eligible and urgent – deploy through the canary path with a shortened soak.",
        "deploy_staged": "Eligible – include in the normal canary → staged rollout.",
        "deploy_staged_caution": "Eligible with caveats (optional evidence missing/failed) – stage late, watch closely.",
        "request_approval": "No technical blocker, but an approval gate applies – obtain sign-off before deploying.",
        "collect_evidence": "Required evidence is missing – gather it before scheduling. Not treated as safe.",
        "resolve_blockers": "Negative evidence blocks deployment – fix or hold until the blocker clears.",
        "escalate_mitigate": "Urgent but NOT deployable – escalate to a human and apply compensating controls (isolate/restrict exposure) meanwhile.",
    }
    return Assessment(
        machine_id=machine.id, urgency=urgency, compatibility_risk=risk, uncertainty=uncertainty,
        readiness=readiness, blockers=blockers, warnings=warnings, action=action,  # type: ignore[arg-type]
        summary=summaries[action], reasons=reasons,
    )


def assess_fleet(machines: list[Machine], patches: dict[str, Patch], cfg: ScoringConfig) -> dict[str, Assessment]:
    return {m.id: assess_machine(m, patches[m.patch_id], cfg) for m in machines}


DEPLOYABLE = ("ready", "ready_with_caution")
