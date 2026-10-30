"""SQLite persistence: inventory, settings, rollouts, experiments and the audit log."""
from __future__ import annotations

import csv
import io
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from .fleet import DEFAULT_FLEET_SIZE, DEFAULT_SEED, PATCHES, generate_fleet
from .models import Machine, Patch, RolloutState, ScoringConfig

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "osguard.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS machines (
  id TEXT PRIMARY KEY, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS patches (
  id TEXT PRIMARY KEY, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rollouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  strategy TEXT NOT NULL, scenario_id TEXT NOT NULL, status TEXT NOT NULL, state TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS experiments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, scenario_id TEXT NOT NULL,
  seed INTEGER NOT NULL, trials INTEGER NOT NULL, result TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, category TEXT NOT NULL, action TEXT NOT NULL,
  subject TEXT, rule TEXT, detail TEXT NOT NULL DEFAULT '{}', rollout_id INTEGER, experiment_id INTEGER,
  sim_minute REAL
);
CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_events(category);
CREATE INDEX IF NOT EXISTS idx_audit_rollout ON audit_events(rollout_id);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def resolve_db_path(path: str | os.PathLike | None = None) -> str:
    p = Path(path or os.environ.get("OSGUARD_DB") or DEFAULT_DB)
    p.parent.mkdir(parents=True, exist_ok=True)
    return str(p)


@contextmanager
def connect(path: str) -> Iterator[sqlite3.Connection]:
    # FastAPI may open the dependency in one worker thread and run the handler in another; each request
    # owns its connection and uses it sequentially, so cross-thread hand-off is safe.
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(path: str) -> None:
    with connect(path) as c:
        c.executescript(SCHEMA)
        if c.execute("SELECT COUNT(*) FROM machines").fetchone()[0] == 0:
            seed_fleet(c, DEFAULT_SEED, DEFAULT_FLEET_SIZE)
            log(c, "system", "FLEET_SEEDED", subject="fleet", detail={"seed": DEFAULT_SEED, "size": DEFAULT_FLEET_SIZE, "synthetic": True})


def seed_fleet(c: sqlite3.Connection, seed: int, size: int) -> None:
    c.execute("DELETE FROM machines")
    c.execute("DELETE FROM patches")
    c.executemany("INSERT INTO patches(id,data) VALUES(?,?)", [(p.id, p.model_dump_json()) for p in PATCHES])
    c.executemany("INSERT INTO machines(id,data) VALUES(?,?)", [(m.id, m.model_dump_json()) for m in generate_fleet(seed, size)])
    c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('fleet_seed',?)", (json.dumps({"seed": seed, "size": size}),))


def load_machines(c: sqlite3.Connection) -> list[Machine]:
    return [Machine.model_validate_json(r["data"]) for r in c.execute("SELECT data FROM machines ORDER BY id")]


def load_patches(c: sqlite3.Connection) -> dict[str, Patch]:
    return {p.id: p for p in (Patch.model_validate_json(r["data"]) for r in c.execute("SELECT data FROM patches"))}


def get_scoring(c: sqlite3.Connection) -> ScoringConfig:
    row = c.execute("SELECT value FROM settings WHERE key='scoring'").fetchone()
    return ScoringConfig.model_validate_json(row["value"]) if row else ScoringConfig()


def set_scoring(c: sqlite3.Connection, cfg: ScoringConfig) -> None:
    c.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('scoring',?)", (cfg.model_dump_json(),))


def get_fleet_meta(c: sqlite3.Connection) -> dict:
    row = c.execute("SELECT value FROM settings WHERE key='fleet_seed'").fetchone()
    return json.loads(row["value"]) if row else {"seed": DEFAULT_SEED, "size": DEFAULT_FLEET_SIZE}


# --------------------------------------------------------------------------- audit


def log(c: sqlite3.Connection, category: str, action: str, *, subject: str | None = None, rule: str | None = None,
        detail: dict | None = None, rollout_id: int | None = None, experiment_id: int | None = None,
        sim_minute: float | None = None) -> int:
    cur = c.execute(
        "INSERT INTO audit_events(ts,category,action,subject,rule,detail,rollout_id,experiment_id,sim_minute) VALUES(?,?,?,?,?,?,?,?,?)",
        (now_iso(), category, action, subject, rule, json.dumps(detail or {}, default=str), rollout_id, experiment_id, sim_minute),
    )
    return int(cur.lastrowid)


def query_audit(c: sqlite3.Connection, *, category: str | None = None, q: str | None = None, rollout_id: int | None = None,
                experiment_id: int | None = None, rule: str | None = None, limit: int = 200, offset: int = 0) -> tuple[int, list[dict]]:
    where, args = [], []
    if category:
        where.append("category=?"); args.append(category)
    if rollout_id is not None:
        where.append("rollout_id=?"); args.append(rollout_id)
    if experiment_id is not None:
        where.append("experiment_id=?"); args.append(experiment_id)
    if rule:
        where.append("rule=?"); args.append(rule)
    if q:
        where.append("(action LIKE ? OR subject LIKE ? OR rule LIKE ? OR detail LIKE ?)")
        args += [f"%{q}%"] * 4
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    total = c.execute(f"SELECT COUNT(*) FROM audit_events{clause}", args).fetchone()[0]
    rows = c.execute(f"SELECT * FROM audit_events{clause} ORDER BY id DESC LIMIT ? OFFSET ?", [*args, limit, offset]).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["detail"] = json.loads(d["detail"])
        out.append(d)
    return total, out


def audit_csv(rows: list[dict]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "ts", "category", "action", "subject", "rule", "rollout_id", "experiment_id", "sim_minute", "detail"])
    for r in rows:
        w.writerow([r["id"], r["ts"], r["category"], r["action"], r["subject"], r["rule"], r["rollout_id"],
                    r["experiment_id"], r["sim_minute"], json.dumps(r["detail"])])
    return buf.getvalue()


# --------------------------------------------------------------------------- rollouts / experiments


def save_rollout(c: sqlite3.Connection, state: RolloutState) -> RolloutState:
    """Insert or update a rollout and write any not-yet-audited events to the audit log."""
    ts = now_iso()
    if state.id is None:
        cur = c.execute("INSERT INTO rollouts(created_at,updated_at,strategy,scenario_id,status,state) VALUES(?,?,?,?,?,?)",
                        (ts, ts, state.strategy, state.scenario_id, state.status, "{}"))
        state.id = int(cur.lastrowid)
        log(c, "rollout", "ROLLOUT_CREATED", subject=f"rollout-{state.id}", rule=state.strategy.upper(), rollout_id=state.id,
            detail={"scenario": state.scenario_id, "seed": state.seed, "config": state.config.model_dump()})
    for ev in state.events[state.persisted_events:]:
        if ev.kind == "MACHINE_PATCHED":
            continue  # high-volume and implied by BATCH_STARTED; the full log stays in the rollout state
        log(c, "rollout", ev.kind, subject=ev.machine_id or f"rollout-{state.id}", rule=ev.rule, rollout_id=state.id,
            sim_minute=ev.minute, detail={"message": ev.message, "batch": ev.batch, **ev.data})
    state.persisted_events = len(state.events)
    c.execute("UPDATE rollouts SET updated_at=?, status=?, state=? WHERE id=?", (ts, state.status, state.model_dump_json(), state.id))
    return state


def load_rollout(c: sqlite3.Connection, rollout_id: int) -> RolloutState | None:
    row = c.execute("SELECT state FROM rollouts WHERE id=?", (rollout_id,)).fetchone()
    if not row:
        return None
    st = RolloutState.model_validate_json(row["state"])
    st.id = rollout_id
    return st


def list_rollouts(c: sqlite3.Connection, limit: int = 50) -> list[dict]:
    rows = c.execute("SELECT id,created_at,updated_at,strategy,scenario_id,status FROM rollouts ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


def save_experiment(c: sqlite3.Connection, result: dict) -> int:
    cur = c.execute("INSERT INTO experiments(created_at,scenario_id,seed,trials,result) VALUES(?,?,?,?,?)",
                    (now_iso(), result["scenario_id"], result["seed"], result["trials"], json.dumps(result)))
    return int(cur.lastrowid)


def load_experiment(c: sqlite3.Connection, exp_id: int) -> dict | None:
    row = c.execute("SELECT id,created_at,result FROM experiments WHERE id=?", (exp_id,)).fetchone()
    if not row:
        return None
    d = json.loads(row["result"])
    d["id"], d["created_at"] = row["id"], row["created_at"]
    return d


def list_experiments(c: sqlite3.Connection, limit: int = 100) -> list[dict]:
    rows = c.execute("SELECT id,created_at,scenario_id,seed,trials,result FROM experiments ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    out = []
    for r in rows:
        res = json.loads(r["result"])
        out.append({"id": r["id"], "created_at": r["created_at"], "scenario_id": r["scenario_id"], "seed": r["seed"],
                    "trials": r["trials"], "summary": res["summary"]})
    return out
