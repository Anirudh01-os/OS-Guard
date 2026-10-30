import pytest
from pydantic import ValidationError

from osguard.models import ScoringConfig
from osguard.scoring import assess_machine, compute_urgency
from conftest import make_machine


def test_urgency_components_sum_to_score_and_weights_normalise(patches, scoring):
    m = make_machine(exposure="internet", criticality=5)
    u = compute_urgency(m, patches[m.patch_id], scoring)
    assert abs(sum(c.points for c in u.components) - u.score) < 0.05
    assert abs(sum(c.weight for c in u.components) - 1) < 0.01
    assert 0 <= u.score <= 100


def test_urgency_monotonic_in_exposure_and_criticality(patches, scoring):
    p = patches["SYN-UBU-2026-41"]
    lo = compute_urgency(make_machine(exposure="isolated", criticality=1), p, scoring).score
    mid = compute_urgency(make_machine(exposure="internal", criticality=3), p, scoring).score
    hi = compute_urgency(make_machine(exposure="internet", criticality=5), p, scoring).score
    assert lo < mid < hi


def test_weights_are_configurable(patches):
    m = make_machine(exposure="internet")
    p = patches[m.patch_id]
    only_exposure = ScoringConfig(w_severity=0, w_exposure=1, w_criticality=0, w_age=0)
    assert compute_urgency(m, p, only_exposure).score == 100.0


def test_known_exploited_raises_severity(patches, scoring):
    m = make_machine()
    p = patches[m.patch_id]
    base = compute_urgency(m, p, scoring).score
    p.known_exploited = True
    assert compute_urgency(m, p, scoring).score > base


def test_clean_machine_is_ready(patches, scoring):
    a = assess_machine(make_machine(), patches["SYN-UBU-2026-41"], scoring)
    assert a.readiness == "ready" and not a.blockers and a.action in ("deploy_staged", "deploy_expedited")


def test_failed_mandatory_check_blocks_and_never_ready(patches, scoring):
    m = make_machine()
    m.checks["driver_compat"] = "fail"
    a = assess_machine(m, patches[m.patch_id], scoring)
    assert a.readiness == "blocked"
    assert any(b.code == "B1_MANDATORY_CHECK_FAILED" for b in a.blockers)
    assert a.compatibility_risk > 0


def test_missing_mandatory_evidence_is_not_silently_safe(patches, scoring):
    m = make_machine()
    m.checks["backup_verified"] = "unknown"
    a = assess_machine(m, patches[m.patch_id], scoring)
    assert a.readiness == "insufficient_evidence"
    assert a.uncertainty > 0 and a.compatibility_risk == 0  # uncertainty and risk are tracked separately


def test_missing_telemetry_blocks(patches, scoring):
    a = assess_machine(make_machine(telemetry_present=False), patches["SYN-UBU-2026-41"], scoring)
    assert a.readiness == "insufficient_evidence"
    assert any(b.code == "B3_NO_TELEMETRY" for b in a.blockers)


def test_vendor_hold_and_degraded_health_block(patches, scoring):
    m = make_machine(id="vm-002", os_family="Windows 11", os_version="24H2", patch_id="SYN-W11-2026-10")
    assert assess_machine(m, patches[m.patch_id], scoring).readiness == "blocked"
    sick = make_machine()
    sick.health.latency_ms = 80
    a = assess_machine(sick, patches[sick.patch_id], scoring)
    assert a.readiness == "blocked" and any(b.code == "B5_PRE_UPDATE_HEALTH_DEGRADED" for b in a.blockers)


def test_negative_evidence_outranks_missing_evidence(patches, scoring):
    m = make_machine(telemetry_present=False)
    m.checks["app_compat"] = "fail"
    assert assess_machine(m, patches[m.patch_id], scoring).readiness == "blocked"


def test_ics_needs_approval_and_urgent_blocked_escalates(patches, scoring):
    ics = make_machine(os_family="ICS/Embedded", os_version="HMI 7.1", patch_id="SYN-ICS-2026-02", exposure="isolated", criticality=5)
    assert assess_machine(ics, patches[ics.patch_id], scoring).readiness == "needs_approval"
    m = make_machine(exposure="internet", criticality=5)
    m.checks["app_compat"] = "fail"
    patches[m.patch_id].cvss, patches[m.patch_id].known_exploited = 9.8, True
    a = assess_machine(m, patches[m.patch_id], scoring)
    assert a.urgency.band == "critical" and a.action == "escalate_mitigate"


def test_compliant_machine_needs_no_action(patches, scoring):
    a = assess_machine(make_machine(patch_status="compliant"), patches["SYN-UBU-2026-41"], scoring)
    assert a.readiness == "compliant" and a.action == "no_action"


def test_every_assessment_explains_itself(patches, scoring):
    m = make_machine()
    m.checks["app_compat"] = "fail"
    a = assess_machine(m, patches[m.patch_id], scoring)
    assert a.summary and len(a.reasons) >= 3


def test_invalid_scoring_config_rejected():
    with pytest.raises(ValidationError):
        ScoringConfig(w_severity=0, w_exposure=0, w_criticality=0, w_age=0)
    with pytest.raises(ValidationError):
        ScoringConfig(band_medium=80, band_high=50)
