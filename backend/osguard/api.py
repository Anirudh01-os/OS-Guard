"""FastAPI application. Every endpoint is a thin wrapper over the pure engine modules."""
from __future__ import annotations

import json
import os
from collections import Counter
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field

from . import db
from .experiments import run_experiment
from .fleet import DEFAULT_FLEET_SIZE, DEFAULT_SEED
from .models import RolloutConfig, ScoringConfig
from .scenarios import SCENARIOS, apply_scenario, build_config
from .scoring import assess_fleet, assess_machine
from .simulator import InvalidTransition, abort, advance, plan_rollout, run_to_end
from .sources import LIBRARIES, SOURCES, VERIFICATION

DISCLAIMER = ("All machines, patches and outcomes are SYNTHETIC. Results are simulation outputs, "
              "not real-world measurements. OSGuard never modifies a host or installs patches.")
DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"


class RolloutRequest(BaseModel):
    config: RolloutConfig = Field(default_factory=RolloutConfig)
    scenario_id: str = "none"
    seed: int = DEFAULT_SEED
    run: bool = False  # run all batches immediately


class ExperimentRequest(BaseModel):
    scenario_id: str
    seed: int = DEFAULT_SEED
    trials: int = Field(10, ge=1, le=200)
    config: RolloutConfig = Field(default_factory=RolloutConfig)


class ReseedRequest(BaseModel):
    seed: int = Field(DEFAULT_SEED, ge=0, le=2**31 - 1)
    size: int = Field(DEFAULT_FLEET_SIZE, ge=100, le=500)


def create_app(db_path: str | None = None) -> FastAPI:
    path = db.resolve_db_path(db_path)
    db.init_db(path)
    app = FastAPI(title="OSGuard API", version="1.0.0", description=DISCLAIMER)
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                       allow_methods=["*"], allow_headers=["*"])

    def conn():
        with db.connect(path) as c:
            yield c

    def world(c, scenario_id: str = "none", seed: int = DEFAULT_SEED):
        scoring = db.get_scoring(c)
        ms, ps = db.load_machines(c), db.load_patches(c)
        if scenario_id != "none":
            if scenario_id not in SCENARIOS:
                raise HTTPException(404, f"unknown scenario '{scenario_id}'")
            ms, ps, _, _ = apply_scenario(scenario_id, ms, ps, seed)
        return ms, ps, scoring, assess_fleet(ms, ps, scoring)

    @app.get("/api/health")
    def health(c=Depends(conn)):
        n = c.execute("SELECT COUNT(*) FROM machines").fetchone()[0]
        return {"status": "ok", "machines": n, "database": os.path.basename(path), "disclaimer": DISCLAIMER}

    # ------------------------------------------------------------------ dashboard
    @app.get("/api/dashboard")
    def dashboard(c=Depends(conn)):
        ms, ps, _, asm = world(c)
        pending = [m for m in ms if m.patch_status == "pending"]
        by_patch = Counter(m.patch_id for m in pending)
        queue = sorted((m for m in pending if asm[m.id].readiness in ("ready", "ready_with_caution")),
                       key=lambda m: -asm[m.id].urgency.score)[:8]
        stuck = sorted((m for m in pending if asm[m.id].readiness in ("blocked", "insufficient_evidence")),
                       key=lambda m: -asm[m.id].urgency.score)[:6]
        degraded = sum(1 for m in ms if m.health.latency_ratio > 1.5 or m.health.error_rate > 0.03)
        _, recent = db.query_audit(c, limit=8)
        return {
            "meta": db.get_fleet_meta(c),
            "totals": {"machines": len(ms), "pending": len(pending), "compliant": len(ms) - len(pending),
                       "restart_required": sum(1 for m in pending if m.restart_required),
                       "no_telemetry": sum(1 for m in ms if not m.telemetry_present), "degraded": degraded},
            "os_distribution": [{"name": k, "value": v} for k, v in Counter(m.os_family for m in ms).most_common()],
            "readiness": [{"name": k, "value": v} for k, v in Counter(asm[m.id].readiness for m in ms).items()],
            "risk_bands": [{"name": b, "value": sum(1 for m in pending if asm[m.id].urgency.band == b)} for b in ("critical", "high", "medium", "low")],
            "outstanding_patches": [{"patch_id": pid, "title": ps[pid].title, "cvss": ps[pid].cvss, "known_exploited": ps[pid].known_exploited,
                                     "machines": n} for pid, n in by_patch.most_common()],
            "priority_queue": [{"machine_id": m.id, "hostname": m.hostname, "urgency": asm[m.id].urgency.score,
                                "band": asm[m.id].urgency.band, "action": asm[m.id].action} for m in queue],
            "stuck_urgent": [{"machine_id": m.id, "hostname": m.hostname, "urgency": asm[m.id].urgency.score,
                              "band": asm[m.id].urgency.band, "readiness": asm[m.id].readiness,
                              "blockers": [b.code for b in asm[m.id].blockers]} for m in stuck],
            "recent_activity": recent,
            "disclaimer": DISCLAIMER,
        }

    # ------------------------------------------------------------------ fleet
    @app.get("/api/fleet")
    def fleet(
        search: str | None = None, os_family: str | None = None, exposure: str | None = None,
        readiness: str | None = None, criticality: int | None = Query(None, ge=1, le=5),
        patch_status: str | None = None,
        sort: Literal["urgency", "criticality", "hostname", "uncertainty", "risk", "latency"] = "urgency",
        order: Literal["asc", "desc"] = "desc", limit: int = Query(200, ge=1, le=500), offset: int = Query(0, ge=0),
        c=Depends(conn),
    ):
        ms, _, _, asm = world(c)
        items = ms
        if search:
            s = search.lower()
            items = [m for m in items if s in m.hostname.lower() or s in m.id.lower() or s in m.role.lower() or s in m.os_family.lower()]
        if os_family:
            items = [m for m in items if m.os_family == os_family]
        if exposure:
            items = [m for m in items if m.exposure == exposure]
        if criticality:
            items = [m for m in items if m.criticality == criticality]
        if patch_status:
            items = [m for m in items if m.patch_status == patch_status]
        if readiness:
            items = [m for m in items if asm[m.id].readiness == readiness]
        keyf = {
            "urgency": lambda m: asm[m.id].urgency.score, "criticality": lambda m: m.criticality,
            "hostname": lambda m: m.hostname, "uncertainty": lambda m: asm[m.id].uncertainty,
            "risk": lambda m: asm[m.id].compatibility_risk, "latency": lambda m: m.health.latency_ratio,
        }[sort]
        items = sorted(items, key=keyf, reverse=(order == "desc"))
        total = len(items)
        page = items[offset: offset + limit]
        return {"total": total, "items": [
            {**m.model_dump(), "urgency": asm[m.id].urgency.score, "band": asm[m.id].urgency.band, "readiness": asm[m.id].readiness,
             "action": asm[m.id].action, "compatibility_risk": asm[m.id].compatibility_risk, "uncertainty": asm[m.id].uncertainty,
             "blocker_codes": [b.code for b in asm[m.id].blockers]}
            for m in page]}

    @app.get("/api/fleet/facets")
    def facets(c=Depends(conn)):
        ms = db.load_machines(c)
        return {"os_family": sorted({m.os_family for m in ms}), "exposure": ["internet", "internal", "isolated"],
                "readiness": ["ready", "ready_with_caution", "needs_approval", "insufficient_evidence", "blocked", "compliant"]}

    @app.get("/api/fleet/{machine_id}")
    def machine_detail(machine_id: str, c=Depends(conn)):
        ms, ps, scoring, _ = world(c)
        m = next((x for x in ms if x.id == machine_id), None)
        if not m:
            raise HTTPException(404, f"machine '{machine_id}' not found")
        return {"machine": m, "patch": ps[m.patch_id], "assessment": assess_machine(m, ps[m.patch_id], scoring)}

    @app.post("/api/fleet/reseed")
    def reseed(req: ReseedRequest, c=Depends(conn)):
        db.seed_fleet(c, req.seed, req.size)
        db.log(c, "system", "FLEET_RESEEDED", subject="fleet", detail={"seed": req.seed, "size": req.size, "synthetic": True})
        return {"seed": req.seed, "size": req.size}

    @app.get("/api/patches")
    def patches(c=Depends(conn)):
        return list(db.load_patches(c).values())

    # ------------------------------------------------------------------ config
    @app.get("/api/config/scoring")
    def get_scoring(c=Depends(conn)):
        return db.get_scoring(c)

    @app.put("/api/config/scoring")
    def put_scoring(cfg: ScoringConfig, c=Depends(conn)):
        before = db.get_scoring(c).model_dump()
        db.set_scoring(c, cfg)
        changed = {k: {"from": before[k], "to": v} for k, v in cfg.model_dump().items() if before[k] != v}
        db.log(c, "config", "SCORING_CONFIG_UPDATED", subject="scoring", rule="CONFIG", detail={"changed": changed})
        return cfg

    @app.post("/api/config/scoring/reset")
    def reset_scoring(c=Depends(conn)):
        cfg = ScoringConfig()
        db.set_scoring(c, cfg)
        db.log(c, "config", "SCORING_CONFIG_RESET", subject="scoring", rule="CONFIG")
        return cfg

    @app.get("/api/config/rollout-defaults")
    def rollout_defaults():
        return RolloutConfig()

    @app.get("/api/scenarios")
    def scenarios():
        return [s.meta for s in SCENARIOS.values()]

    # ------------------------------------------------------------------ rollouts
    @app.post("/api/rollouts", status_code=201)
    def create_rollout(req: RolloutRequest, c=Depends(conn)):
        ms, ps, scoring, asm = world(c, req.scenario_id, req.seed)
        _, _, cfg_patch, faults = apply_scenario(req.scenario_id, [], {}, req.seed) if req.scenario_id != "none" else ([], {}, {}, [])
        cfg = build_config(req.config, req.config.strategy, cfg_patch, faults)
        state = plan_rollout(ms, ps, asm, cfg, scoring, scenario_id=req.scenario_id, seed=req.seed)
        if req.run:
            run_to_end(state, {m.id: m for m in ms}, ps, scoring)
        db.save_rollout(c, state)
        return state

    @app.get("/api/rollouts")
    def rollouts(c=Depends(conn)):
        return db.list_rollouts(c)

    def get_state(c, rid: int):
        st = db.load_rollout(c, rid)
        if not st:
            raise HTTPException(404, f"rollout {rid} not found")
        return st

    @app.get("/api/rollouts/{rid}")
    def rollout(rid: int, c=Depends(conn)):
        from .analytics import compute_metrics, exposure_curve, timeline
        st = get_state(c, rid)
        ms, ps, _, asm = world(c, st.scenario_id, st.seed)
        by = {m.id: m for m in ms}
        return {"state": st, "metrics": compute_metrics(st, by, asm), "timeline": timeline(st), "exposure_curve": exposure_curve(st, asm)}

    @app.post("/api/rollouts/{rid}/advance")
    def rollout_advance(rid: int, c=Depends(conn)):
        st = get_state(c, rid)
        ms, ps, scoring, _ = world(c, st.scenario_id, st.seed)
        try:
            advance(st, {m.id: m for m in ms}, ps, scoring)
        except InvalidTransition as e:
            raise HTTPException(409, str(e))
        db.save_rollout(c, st)
        return rollout(rid, c)

    @app.post("/api/rollouts/{rid}/abort")
    def rollout_abort(rid: int, c=Depends(conn)):
        st = get_state(c, rid)
        try:
            abort(st)
        except InvalidTransition as e:
            raise HTTPException(409, str(e))
        db.save_rollout(c, st)
        return rollout(rid, c)

    # ------------------------------------------------------------------ experiments
    @app.post("/api/experiments", status_code=201)
    def create_experiment(req: ExperimentRequest, c=Depends(conn)):
        if req.scenario_id not in SCENARIOS:
            raise HTTPException(404, f"unknown scenario '{req.scenario_id}'")
        ms, ps, scoring = db.load_machines(c), db.load_patches(c), db.get_scoring(c)
        result = run_experiment(ms, ps, scoring, req.config, scenario_id=req.scenario_id, seed=req.seed, trials=req.trials)
        eid = db.save_experiment(c, result)
        s = result["summary"]
        db.log(c, "experiment", "EXPERIMENT_COMPLETED", subject=req.scenario_id, rule="EXPERIMENT", experiment_id=eid,
               detail={"seed": req.seed, "trials": req.trials, "summary": s, "synthetic": True})
        rep = result["representative"]
        for strat, data in rep.items():
            for rule, n in data["metrics"]["safety_violation_rules"].items():
                db.log(c, "experiment", "SAFETY_RULE_TRIGGERED", subject=f"{req.scenario_id}/{strat}", rule=rule, experiment_id=eid,
                       detail={"count": n, "strategy": strat})
            if data["halt_reason"]:
                db.log(c, "experiment", "AUTO_HALT", subject=f"{req.scenario_id}/{strat}", rule="AUTO_HALT", experiment_id=eid,
                       detail={"reason": data["halt_reason"]})
        result["id"] = eid
        return result

    @app.get("/api/experiments")
    def experiments(c=Depends(conn)):
        return db.list_experiments(c)

    @app.get("/api/experiments/{eid}")
    def experiment(eid: int, c=Depends(conn)):
        r = db.load_experiment(c, eid)
        if not r:
            raise HTTPException(404, f"experiment {eid} not found")
        return r

    @app.get("/api/analytics")
    def analytics(c=Depends(conn)):
        """Latest experiment per scenario, for side-by-side comparison."""
        latest: dict[str, dict] = {}
        for e in db.list_experiments(c, limit=500):
            latest.setdefault(e["scenario_id"], e)
        return {"scenarios": [s.meta for s in SCENARIOS.values()], "latest": list(latest.values()), "disclaimer": DISCLAIMER}

    # ------------------------------------------------------------------ audit
    @app.get("/api/audit")
    def audit(category: str | None = None, q: str | None = None, rule: str | None = None, rollout_id: int | None = None,
              experiment_id: int | None = None, limit: int = Query(100, ge=1, le=1000), offset: int = Query(0, ge=0), c=Depends(conn)):
        total, rows = db.query_audit(c, category=category, q=q, rule=rule, rollout_id=rollout_id, experiment_id=experiment_id,
                                     limit=limit, offset=offset)
        cats = [r["category"] for r in c.execute("SELECT DISTINCT category FROM audit_events").fetchall()]
        return {"total": total, "items": rows, "categories": sorted(cats)}

    @app.get("/api/audit/export")
    def audit_export(format: Literal["csv", "json"] = "csv", category: str | None = None, q: str | None = None,
                     rollout_id: int | None = None, experiment_id: int | None = None, c=Depends(conn)):
        _, rows = db.query_audit(c, category=category, q=q, rollout_id=rollout_id, experiment_id=experiment_id, limit=10000)
        if format == "json":
            return PlainTextResponse(json.dumps({"disclaimer": DISCLAIMER, "events": rows}, indent=2), media_type="application/json",
                                     headers={"Content-Disposition": "attachment; filename=osguard-audit.json"})
        return PlainTextResponse(db.audit_csv(rows), media_type="text/csv",
                                 headers={"Content-Disposition": "attachment; filename=osguard-audit.csv"})

    # ------------------------------------------------------------------ research
    @app.get("/api/sources")
    def sources():
        return {"sources": SOURCES, "libraries": LIBRARIES, "verification": VERIFICATION}

    # ------------------------------------------------------------------ static frontend
    if DIST.exists():
        @app.get("/{full_path:path}", include_in_schema=False)
        def spa(full_path: str):
            if full_path.startswith("api/"):
                raise HTTPException(404, "not found")
            f = (DIST / full_path).resolve()
            if full_path and DIST.resolve() in f.parents and f.is_file():
                return FileResponse(f)
            return FileResponse(DIST / "index.html")

    return app
