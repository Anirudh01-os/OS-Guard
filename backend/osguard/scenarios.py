"""Reproducible experiment scenarios.

A scenario deterministically rewrites a copy of the synthetic fleet (never the stored
inventory) and/or adjusts the failure model, so a given (scenario, seed) always replays
identically.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Callable

from .models import FaultInjection, Machine, Patch, RolloutConfig, Scenario


@dataclass
class ScenarioSpec:
    meta: Scenario
    mutate: Callable[[list[Machine], dict[str, Patch], random.Random], None] = lambda m, p, r: None
    config_patch: dict = field(default_factory=dict)
    faults: list[FaultInjection] = field(default_factory=list)


def _healthy(machines, patches, rng):
    for m in machines:  # a clean world: all evidence present and passing
        m.checks = {k: "pass" for k in m.checks}
        m.telemetry_present = True
        h = m.health
        h.latency_ms, h.error_rate = h.baseline_latency_ms, min(h.error_rate, 0.01)
    for p in patches.values():
        p.hold_versions = []


def _compat_failures(machines, patches, rng):
    for m in machines:
        if m.os_family in ("Windows Server", "Ubuntu") and rng.random() < 0.35:
            m.checks["driver_compat"] = "fail"
        if m.role in ("database", "api") and rng.random() < 0.20:
            m.checks["app_compat"] = "fail"


def _critical_vuln(machines, patches, rng):
    for p in patches.values():
        p.cvss, p.known_exploited = max(p.cvss, 9.8), True
    for m in machines:
        if m.exposure == "internet":
            m.criticality = max(m.criticality, 4)


def _missing_telemetry(machines, patches, rng):
    for m in machines:
        if rng.random() < 0.30:
            m.telemetry_present = False
            if rng.random() < 0.5:
                m.checks["app_compat"] = "unknown"


def _degraded(machines, patches, rng):
    for m in machines:
        if rng.random() < 0.25:
            m.health.latency_ms = round(m.health.baseline_latency_ms * rng.uniform(1.8, 3.0), 2)
            m.health.error_rate = round(rng.uniform(0.04, 0.09), 4)


SCENARIOS: dict[str, ScenarioSpec] = {
    s.meta.id: s
    for s in [
        ScenarioSpec(
            Scenario(id="healthy_update", name="Healthy update",
                     description="All evidence present and passing; only the tiny background failure rate applies.",
                     expectation="Both strategies should complete. The staged strategy pays a time cost (soak windows) and may leave exposure slightly higher."),
            mutate=_healthy, config_patch={"base_failure_probability": 0.0},
        ),
        ScenarioSpec(
            Scenario(id="compat_failure", name="Compatibility failures",
                     description="A large share of Windows Server/Ubuntu hosts fail the driver check and many database/API hosts fail the application check.",
                     expectation="The readiness gate should defer machines with failed evidence; the all-at-once baseline deploys to them and suffers a large blast radius."),
            mutate=_compat_failures,
        ),
        ScenarioSpec(
            Scenario(id="critical_vuln", name="Critical vulnerability",
                     description="Every patch is rated 9.8 and known-exploited, and internet-facing hosts become highly critical. Staged soak is shortened to 10 minutes.",
                     expectation="Shows the speed/safety trade-off: exposure matters more, but gating must still hold. Blocked critical machines escalate instead of being deployed."),
            mutate=_critical_vuln, config_patch={"soak_minutes": 10},
        ),
        ScenarioSpec(
            Scenario(id="missing_telemetry", name="Missing telemetry",
                     description="30% of machines stop reporting health telemetry; half also lose their application-compatibility result.",
                     expectation="Absence of evidence is treated as not-safe: those machines are deferred (possibly unnecessarily). The baseline deploys blind."),
            mutate=_missing_telemetry, config_patch={"base_failure_probability": 0.12},
        ),
        ScenarioSpec(
            Scenario(id="degraded_health", name="Degraded application health",
                     description="25% of machines are already slow/erroring before the update, and a regression there is more likely.",
                     expectation="The pre-update health gate defers degraded hosts. The baseline deploys onto them and cannot attribute regressions."),
            mutate=_degraded,
        ),
        ScenarioSpec(
            Scenario(id="fault_injection", name="Injected fault (bad build)",
                     description="A regression affects 60% of Windows Server hosts regardless of their recorded evidence (an unforeseeable defect).",
                     expectation="Evidence gating cannot predict this; the canary + automatic halt should limit the blast radius. Undetected subtle regressions remain possible."),
            faults=[FaultInjection(kind="error_spike", probability=0.6, os_family="Windows Server", label="bad cumulative update")],
        ),
    ]
}


def apply_scenario(scenario_id: str, machines: list[Machine], patches: dict[str, Patch], seed: int):
    """Return (machines_copy, patches_copy, extra_config_patch, faults)."""
    spec = SCENARIOS.get(scenario_id)
    ms = [m.model_copy(deep=True) for m in machines]
    ps = {k: v.model_copy(deep=True) for k, v in patches.items()}
    if spec is None:
        return ms, ps, {}, []
    spec.mutate(ms, ps, random.Random(f"{scenario_id}:{seed}"))
    return ms, ps, dict(spec.config_patch), [f.model_copy() for f in spec.faults]


def build_config(base: RolloutConfig, strategy: str, patch: dict, faults: list[FaultInjection]) -> RolloutConfig:
    data = base.model_dump()
    data.update(patch)
    data["strategy"] = strategy
    data["faults"] = [f.model_dump() for f in list(base.faults) + faults]
    return RolloutConfig.model_validate(data)
