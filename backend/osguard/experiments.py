"""Experiment runner: same scenario, same fleet, both strategies, several outcome seeds."""
from __future__ import annotations

from .analytics import compute_metrics, exposure_curve, summarise_trials, timeline
from .models import Machine, Patch, RolloutConfig, ScoringConfig
from .scenarios import apply_scenario, build_config
from .scoring import assess_fleet
from .simulator import plan_rollout, run_to_end

MAX_TRIALS = 200


def run_experiment(
    machines: list[Machine],
    patches: dict[str, Patch],
    scoring: ScoringConfig,
    base_cfg: RolloutConfig,
    *,
    scenario_id: str,
    seed: int,
    trials: int,
) -> dict:
    if not 1 <= trials <= MAX_TRIALS:
        raise ValueError(f"trials must be within 1..{MAX_TRIALS}")
    ms, ps, cfg_patch, faults = apply_scenario(scenario_id, machines, patches, seed)
    assessments = assess_fleet(ms, ps, scoring)
    by_id = {m.id: m for m in ms}
    per: dict[str, list[dict]] = {"staged": [], "all_at_once": []}
    representative: dict[str, dict] = {}
    for t in range(trials):
        for strategy in ("staged", "all_at_once"):
            cfg = build_config(base_cfg, strategy, cfg_patch, faults)
            st = plan_rollout(ms, ps, assessments, cfg, scoring, scenario_id=scenario_id, seed=seed + t)
            run_to_end(st, by_id, ps, scoring)
            metrics = compute_metrics(st, by_id, assessments)
            per[strategy].append(metrics)
            if t == 0:
                representative[strategy] = {
                    "metrics": metrics,
                    "timeline": timeline(st),
                    "exposure_curve": exposure_curve(st, assessments),
                    "batch_results": [b.model_dump() for b in st.batch_results],
                    "events": [e.model_dump() for e in st.events if e.kind != "MACHINE_PATCHED"][:400],
                    "halt_reason": st.halt_reason,
                }
    summary = {s: summarise_trials(v) for s, v in per.items()}
    return {
        "scenario_id": scenario_id,
        "seed": seed,
        "trials": trials,
        "summary": summary,
        "representative": representative,
        "per_trial": per,
        "disclaimer": "Simulation output on a synthetic fleet; not a real-world measurement.",
    }
