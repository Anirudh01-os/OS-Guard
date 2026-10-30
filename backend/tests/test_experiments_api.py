import pytest
from fastapi.testclient import TestClient

from osguard.api import create_app
from osguard.experiments import run_experiment
from osguard.fleet import PATCHES, generate_fleet
from osguard.models import RolloutConfig, ScoringConfig
from osguard.scenarios import SCENARIOS


def exp(sid, trials=4, seed=2026):
    return run_experiment(generate_fleet(), {p.id: p for p in PATCHES}, ScoringConfig(), RolloutConfig(),
                          scenario_id=sid, seed=seed, trials=trials)


def test_experiments_are_reproducible():
    assert exp("compat_failure") == exp("compat_failure")
    assert exp("compat_failure", seed=1)["summary"] != exp("compat_failure", seed=2)["summary"]


@pytest.mark.parametrize("sid", list(SCENARIOS))
def test_every_scenario_runs_and_staged_never_violates_rules(sid):
    r = exp(sid)
    assert r["summary"]["staged"]["safety_violations"]["max"] == 0
    assert set(r["representative"]) == {"staged", "all_at_once"}
    assert "synthetic" in r["disclaimer"].lower()


def test_compat_failure_scenario_shrinks_blast_radius():
    s = exp("compat_failure", trials=6)["summary"]
    assert s["staged"]["blast_radius"]["mean"] < s["all_at_once"]["blast_radius"]["mean"]
    assert s["all_at_once"]["safety_violations"]["mean"] > 0


def test_missing_telemetry_causes_unnecessary_delays_but_no_violations():
    s = exp("missing_telemetry")["summary"]
    assert s["staged"]["unnecessary_delays"]["mean"] > 0 and s["all_at_once"]["unnecessary_delays"]["max"] == 0


def test_injected_fault_triggers_halt_in_staged():
    r = exp("fault_injection", trials=6)
    assert r["summary"]["staged"]["halted_trials"] >= 1
    assert r["summary"]["staged"]["blast_radius"]["mean"] < r["summary"]["all_at_once"]["blast_radius"]["mean"]


def test_trial_bounds_enforced():
    with pytest.raises(ValueError):
        exp("healthy_update", trials=0)


# ------------------------------------------------------------------ API / persistence / audit


def test_health_and_fleet_endpoints(client):
    assert client.get("/api/health").json()["machines"] >= 100
    r = client.get("/api/fleet", params={"readiness": "blocked", "sort": "urgency", "order": "desc"}).json()
    assert r["total"] > 0 and all(i["readiness"] == "blocked" for i in r["items"])
    scores = [i["urgency"] for i in r["items"]]
    assert scores == sorted(scores, reverse=True)
    assert client.get("/api/fleet", params={"search": "vm-007"}).json()["total"] == 1
    d = client.get("/api/fleet/vm-007").json()
    assert d["assessment"]["reasons"] and d["patch"]["id"] == d["machine"]["patch_id"]
    assert client.get("/api/fleet/nope").status_code == 404
    assert client.get("/api/fleet", params={"criticality": 9}).status_code == 422


def test_dashboard_shape(client):
    d = client.get("/api/dashboard").json()
    assert d["totals"]["machines"] >= 100 and d["os_distribution"] and d["outstanding_patches"] and "SYNTHETIC" in d["disclaimer"]


def test_rollout_lifecycle_and_audit(client):
    r = client.post("/api/rollouts", json={"config": {"batch_percents": [10, 30, 60]}, "scenario_id": "compat_failure"})
    assert r.status_code == 201
    rid = r.json()["id"]
    assert r.json()["status"] == "planned"
    a = client.post(f"/api/rollouts/{rid}/advance").json()
    assert a["state"]["status"] in ("running", "halted")
    for _ in range(10):
        if a["state"]["status"] in ("completed", "halted"):
            break
        a = client.post(f"/api/rollouts/{rid}/advance").json()
    assert a["state"]["status"] in ("completed", "halted")
    assert client.post(f"/api/rollouts/{rid}/advance").status_code == 409
    assert client.post(f"/api/rollouts/{rid}/abort").status_code == 409
    audit = client.get("/api/audit", params={"rollout_id": rid, "limit": 500}).json()
    actions = {e["action"] for e in audit["items"]}
    assert {"ROLLOUT_CREATED", "MACHINE_DEFERRED", "BATCH_STARTED", "HEALTH_CHECK"} <= actions
    assert all(e["ts"] for e in audit["items"]) and any(e["rule"] for e in audit["items"])
    ids = [e["id"] for e in audit["items"]]
    assert len(ids) == len(set(ids))


def test_create_rollout_validation(client):
    assert client.post("/api/rollouts", json={"config": {"batch_percents": [10, 10]}}).status_code == 422
    assert client.post("/api/rollouts", json={"scenario_id": "bogus"}).status_code == 404
    assert client.post("/api/rollouts/999/advance").status_code == 404


def test_experiment_persists_and_is_audited(client):
    r = client.post("/api/experiments", json={"scenario_id": "compat_failure", "trials": 3})
    assert r.status_code == 201
    eid = r.json()["id"]
    assert client.get(f"/api/experiments/{eid}").json()["summary"] == r.json()["summary"]
    assert any(e["id"] == eid for e in client.get("/api/experiments").json())
    assert client.get("/api/analytics").json()["latest"][0]["scenario_id"] == "compat_failure"
    audit = client.get("/api/audit", params={"experiment_id": eid}).json()
    assert any(e["action"] == "EXPERIMENT_COMPLETED" for e in audit["items"])
    assert any(e["action"] == "SAFETY_RULE_TRIGGERED" for e in audit["items"])
    assert client.post("/api/experiments", json={"scenario_id": "nope"}).status_code == 404
    assert client.post("/api/experiments", json={"scenario_id": "healthy_update", "trials": 0}).status_code == 422


def test_audit_filter_and_export(client):
    client.post("/api/experiments", json={"scenario_id": "healthy_update", "trials": 2})
    client.put("/api/config/scoring", json={**client.get("/api/config/scoring").json(), "w_severity": 0.5})
    cfg = client.get("/api/audit", params={"category": "config"}).json()
    assert cfg["total"] == 1 and cfg["items"][0]["detail"]["changed"]["w_severity"]["to"] == 0.5
    csv = client.get("/api/audit/export", params={"format": "csv", "category": "config"})
    assert csv.headers["content-type"].startswith("text/csv") and "SCORING_CONFIG_UPDATED" in csv.text
    js = client.get("/api/audit/export", params={"format": "json"}).json()
    assert js["events"] and "SYNTHETIC" in js["disclaimer"]
    assert client.get("/api/audit", params={"q": "EXPERIMENT_COMPLETED"}).json()["total"] >= 1


def test_scoring_config_validation_and_effect(client):
    bad = {**client.get("/api/config/scoring").json(), "band_medium": 90, "band_high": 10}
    assert client.put("/api/config/scoring", json=bad).status_code == 422
    before = client.get("/api/fleet/vm-007").json()["assessment"]["urgency"]["score"]
    cfg = {**client.get("/api/config/scoring").json(), "w_severity": 0, "w_exposure": 1, "w_criticality": 0, "w_age": 0}
    client.put("/api/config/scoring", json=cfg)
    after = client.get("/api/fleet/vm-007").json()["assessment"]["urgency"]["score"]
    assert before != after


def test_database_persistence_across_restart(tmp_path):
    p = str(tmp_path / "persist.db")
    with TestClient(create_app(p)) as c1:
        rid = c1.post("/api/rollouts", json={"run": True}).json()["id"]
        eid = c1.post("/api/experiments", json={"scenario_id": "healthy_update", "trials": 2}).json()["id"]
        total = c1.get("/api/audit").json()["total"]
    with TestClient(create_app(p)) as c2:
        assert c2.get(f"/api/rollouts/{rid}").json()["state"]["status"] in ("completed", "halted")
        assert c2.get(f"/api/experiments/{eid}").status_code == 200
        assert c2.get("/api/audit").json()["total"] == total


def test_reseed_is_audited_and_validated(client):
    assert client.post("/api/fleet/reseed", json={"seed": 5, "size": 10}).status_code == 422
    assert client.post("/api/fleet/reseed", json={"seed": 5, "size": 120}).status_code == 200
    assert client.get("/api/audit", params={"q": "FLEET_RESEEDED"}).json()["total"] == 1


def test_sources_include_required_official_links(client):
    urls = [link["url"] for s in client.get("/api/sources").json()["sources"] for link in s["links"]]
    for u in ("https://learn.microsoft.com/en-us/windows/deployment/update/safeguard-holds",
              "https://docs.aws.amazon.com/systems-manager/latest/userguide/patch-manager.html",
              "https://docs.aws.amazon.com/linux/al2023/ug/live-patching.html",
              "https://docs.cloud.google.com/kubernetes-engine/docs/best-practices/upgrading-clusters",
              "https://www.cisa.gov/resources-tools/resources/ics-recommended-practices"):
        assert u in urls


def test_concurrent_requests_do_not_trip_sqlite_thread_affinity(client):
    # Regression: the per-request connection used to be opened and used in different worker threads.
    from concurrent.futures import ThreadPoolExecutor

    def hit(i):
        return client.get("/api/fleet", params={"limit": 50}).status_code if i % 2 else client.get("/api/dashboard").status_code

    with ThreadPoolExecutor(max_workers=16) as ex:
        codes = list(ex.map(hit, range(80)))
    assert set(codes) == {200}
