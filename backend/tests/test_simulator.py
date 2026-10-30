import pytest

from osguard.analytics import compute_metrics, timeline, violations
from osguard.models import FaultInjection, RolloutConfig, ScoringConfig
from osguard.scoring import assess_fleet
from osguard.simulator import InvalidTransition, abort, advance, plan_rollout, run_to_end, unit
from conftest import make_machine

FAMS = [("Ubuntu", "24.04", "SYN-UBU-2026-41"), ("RHEL", "9.4", "SYN-RHEL-2026-17"), ("Amazon Linux", "2023", "SYN-AL-2026-08")]


def fleet(n=20, crit=lambda i: 1 + i % 3):
    out = []
    for i in range(n):
        fam, ver, pid = FAMS[i % 3]
        out.append(make_machine(i + 1, os_family=fam, os_version=ver, patch_id=pid, criticality=crit(i)))
    return out


def setup(ms, patches, cfg, scoring=None, seed=7):
    scoring = scoring or ScoringConfig()
    asm = assess_fleet(ms, patches, scoring)
    st = plan_rollout(ms, patches, asm, cfg, scoring, seed=seed)
    return st, {m.id: m for m in ms}, asm, scoring


def cfg(**kw):
    base = dict(base_failure_probability=0.0, batch_percents=[10, 30, 60])
    base.update(kw)
    return RolloutConfig(**base)


def test_unit_hash_is_deterministic_and_uniformish():
    assert unit(1, "a", "b") == unit(1, "a", "b")
    vals = [unit(5, i) for i in range(2000)]
    assert 0.45 < sum(vals) / len(vals) < 0.55 and all(0 <= v < 1 for v in vals)


def test_batch_progression_and_state_machine(patches):
    st, by, asm, sc = setup(fleet(), patches, cfg())
    assert st.status == "planned" and [len(b.machine_ids) for b in st.batches] == [2, 6, 12]
    advance(st, by, patches, sc)
    assert st.status == "running" and st.next_batch == 1
    assert [r.state for r in st.results.values()].count("patched") == 2
    advance(st, by, patches, sc)
    advance(st, by, patches, sc)
    assert st.status == "completed" and len(st.batch_results) == 3 and all(b.passed for b in st.batch_results)
    with pytest.raises(InvalidTransition):
        advance(st, by, patches, sc)
    with pytest.raises(InvalidTransition):
        abort(st)


def test_clock_advances_with_soak(patches):
    a = setup(fleet(), patches, cfg(soak_minutes=10))
    b = setup(fleet(), patches, cfg(soak_minutes=60))
    run_to_end(a[0], a[1], patches, a[3])
    run_to_end(b[0], b[1], patches, b[3])
    assert b[0].clock - a[0].clock == pytest.approx(3 * 50)


def test_canary_is_low_criticality_and_covers_families(patches):
    ms = fleet(21, crit=lambda i: 5 if i % 7 == 0 else 1 + i % 2)
    st, *_ = setup(ms, patches, cfg(batch_percents=[15, 85]))
    canary = [m for m in ms if m.id in st.batches[0].machine_ids]
    assert max(m.criticality for m in canary) <= 2
    assert len({m.os_family for m in canary}) == 3


def test_canary_failure_halts_and_skips_later_batches(patches):
    c = cfg(faults=[FaultInjection(kind="error_spike", probability=1.0)])
    st, by, asm, sc = setup(fleet(), patches, c)
    run_to_end(st, by, patches, sc)
    assert st.status == "halted" and "Canary" in st.halt_reason
    assert len(st.batch_results) == 1 and not st.batch_results[0].passed
    states = [r.state for r in st.results.values()]
    assert states.count("skipped") == 18 and states.count("rolled_back") == 2
    assert all(r.patched_at is None for r in st.results.values() if r.state == "skipped")
    ev = [e for e in st.events if e.kind == "ROLLOUT_HALTED"]
    assert len(ev) == 1 and ev[0].rule == "AUTO_HALT" and "18" in ev[0].message


def test_latency_threshold_violation_detected(patches):
    st, by, asm, sc = setup(fleet(), patches, cfg(faults=[FaultInjection(kind="latency_regression", probability=1.0)]))
    run_to_end(st, by, patches, sc)
    assert st.status == "halted"


def test_later_batch_halts_when_fraction_exceeds_tolerance(patches):
    ms = fleet(20, crit=lambda i: 5 if i >= 14 else 1 + i % 2)
    c = cfg(batch_percents=[10, 40, 50], faults=[FaultInjection(kind="error_spike", probability=1.0, min_criticality=5)])
    st, by, asm, sc = setup(ms, patches, c)
    run_to_end(st, by, patches, sc)
    assert st.status == "halted"
    assert [b.passed for b in st.batch_results] == [True, True, False]
    assert st.batch_results[-1].unhealthy_fraction > c.max_unhealthy_fraction


def test_subtle_regression_passes_default_thresholds_but_not_tight_ones(patches):
    f = [FaultInjection(kind="subtle_regression", probability=1.0)]
    st, by, asm, sc = setup(fleet(), patches, cfg(faults=f))
    run_to_end(st, by, patches, sc)
    assert st.status == "completed"
    truly_failed = sum(r.failed for r in st.results.values())  # failure probability is capped at 0.97
    assert truly_failed >= 15
    assert compute_metrics(st, by, asm)["undetected_degraded"] == truly_failed  # honest: thresholds cannot see it
    st2, by2, asm2, sc2 = setup(fleet(), patches, cfg(faults=f, max_latency_ratio=1.1))
    run_to_end(st2, by2, patches, sc2)
    assert st2.status == "halted"


def test_missing_telemetry_fails_closed_unless_disabled(patches):
    ms = fleet(20, crit=lambda i: 1)
    ms[0].telemetry_present = False
    relaxed = ScoringConfig(require_telemetry=False)
    st, by, asm, sc = setup(ms, patches, cfg(), relaxed)
    run_to_end(st, by, patches, sc)
    if ms[0].id in st.batches[0].machine_ids:
        assert st.status == "halted" and st.results[ms[0].id].state == "rolled_back"
    else:
        assert st.results[ms[0].id].state in ("rolled_back", "skipped")
    st2, by2, asm2, sc2 = setup(ms, patches, cfg(fail_closed_on_missing_telemetry=False), relaxed)
    run_to_end(st2, by2, patches, sc2)
    assert st2.status == "completed"


def test_default_policy_defers_machine_without_telemetry(patches):
    ms = fleet()
    ms[0].telemetry_present = False
    st, *_ = setup(ms, patches, cfg())
    assert any(d.machine_id == ms[0].id and "B3_NO_TELEMETRY" in d.codes for d in st.deferred)
    assert all(ms[0].id not in b.machine_ids for b in st.batches)


def test_blocked_machines_are_deferred_with_recorded_reasons(patches):
    ms = fleet()
    ms[3].checks["driver_compat"] = "fail"
    ms[4].checks["backup_verified"] = "unknown"
    st, *_ = setup(ms, patches, cfg())
    d = {x.machine_id: x for x in st.deferred}
    assert d[ms[3].id].readiness == "blocked" and d[ms[4].id].readiness == "insufficient_evidence"
    evs = [e for e in st.events if e.kind == "MACHINE_DEFERRED"]
    assert len(evs) == 2 and all(e.rule for e in evs)


def test_baseline_ignores_gates_staged_has_zero_violations(patches):
    ms = fleet()
    ms[3].checks["driver_compat"] = "fail"
    ms[4].checks["app_compat"] = "unknown"
    ms[5].telemetry_present = False
    base, by, asm, sc = setup(ms, patches, cfg(strategy="all_at_once"))
    staged, *_ = setup(ms, patches, cfg())
    run_to_end(base, by, patches, sc)
    run_to_end(staged, by, patches, sc)
    assert len(base.batches) == 1 and len(base.batches[0].machine_ids) == 20
    rules = {v["rule"] for v in violations(base, by, asm)}
    assert {"B1_MANDATORY_CHECK_FAILED", "B2_MISSING_REQUIRED_EVIDENCE", "B3_NO_TELEMETRY"} <= rules
    assert violations(staged, by, asm) == []


def test_same_seed_same_truth_across_strategies_and_runs(patches):
    f = cfg(base_failure_probability=0.3)
    a = setup(fleet(), patches, f, seed=11)[0]
    b = setup(fleet(), patches, f.model_copy(update={"strategy": "all_at_once"}), seed=11)[0]
    c = setup(fleet(), patches, f, seed=11)[0]
    truth = lambda s: {k: v.failed for k, v in s.results.items()}  # noqa: E731
    assert truth(a) == truth(b) == truth(c)
    assert any(truth(a).values()) and not all(truth(a).values())


def test_abort_planned_rollout_is_allowed_and_terminal(patches):
    st, by, asm, sc = setup(fleet(), patches, cfg())
    abort(st)
    assert st.status == "aborted" and all(r.state == "skipped" for r in st.results.values())
    with pytest.raises(InvalidTransition):
        advance(st, by, patches, sc)


def test_metrics_blast_radius_exposure_and_delays(patches):
    ms = fleet()
    ms[3].checks["driver_compat"] = "fail"  # blocked by the staged gate; may or may not fail in truth
    seed = next(s for s in range(200) if not setup(ms, patches, cfg(), seed=s)[0].results[ms[3].id].failed)
    staged, by, asm, sc = setup(ms, patches, cfg(), seed=seed)
    base, *_ = setup(ms, patches, cfg(strategy="all_at_once"), seed=seed)
    run_to_end(staged, by, patches, sc)
    run_to_end(base, by, patches, sc)
    ms_s, ms_b = compute_metrics(staged, by, asm), compute_metrics(base, by, asm)
    assert ms_s["deferred_by_gate"] == 1
    assert ms_s["unnecessary_delays"] == 1 and ms_b["unnecessary_delays"] == 0  # blocked machine would have succeeded
    assert ms_b["blast_radius"] == 0 and ms_b["completion_fraction"] == 1.0
    assert ms_s["completion_fraction"] == pytest.approx(19 / 20)
    assert ms_s["completion_minutes"] > ms_b["completion_minutes"]  # staged pays a time cost
    assert ms_s["unpatched_exposure"] > ms_b["unpatched_exposure"]  # ...and carries more simulated exposure
    tl = timeline(staged)
    assert tl[0]["patched"] == 0 and tl[-1]["patched"] == 19


def test_blast_radius_smaller_with_staged_when_faults_injected(patches):
    f = [FaultInjection(kind="error_spike", probability=1.0, os_family="RHEL")]
    staged, by, asm, sc = setup(fleet(), patches, cfg(faults=f))
    base, *_ = setup(fleet(), patches, cfg(faults=f, strategy="all_at_once"))
    run_to_end(staged, by, patches, sc)
    run_to_end(base, by, patches, sc)
    s, b = compute_metrics(staged, by, asm), compute_metrics(base, by, asm)
    assert s["blast_radius"] < b["blast_radius"] and s["halted"] and not b["halted"]
    assert b["safety_violations"] >= 1 and "V8_NO_HALT_ON_BREACH" in b["safety_violation_rules"]


def test_invalid_batch_config_rejected():
    with pytest.raises(ValueError):
        RolloutConfig(batch_percents=[10, 20])
    with pytest.raises(ValueError):
        RolloutConfig(batch_percents=[0, 100])
    with pytest.raises(ValueError):
        RolloutConfig(soak_minutes=-1)
