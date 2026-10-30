"""Typed domain models shared by the engine, the database layer and the API.

Everything in this module is synthetic-data oriented: nothing here ever talks to a real
operating system or patching agent.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

CheckStatus = Literal["pass", "fail", "unknown"]
Exposure = Literal["internet", "internal", "isolated"]
PatchStatus = Literal["pending", "compliant"]
Readiness = Literal[
    "ready",
    "ready_with_caution",
    "needs_approval",
    "insufficient_evidence",
    "blocked",
    "compliant",
]
Action = Literal[
    "no_action",
    "deploy_expedited",
    "deploy_staged",
    "deploy_staged_caution",
    "request_approval",
    "collect_evidence",
    "resolve_blockers",
    "escalate_mitigate",
]
Strategy = Literal["staged", "all_at_once"]
RolloutStatus = Literal["planned", "running", "completed", "halted", "aborted"]
FaultKind = Literal["boot_failure", "latency_regression", "error_spike", "subtle_regression"]

MANDATORY_CHECKS: tuple[str, ...] = ("driver_compat", "app_compat", "backup_verified")
OPTIONAL_CHECKS: tuple[str, ...] = ("agent_compat", "disk_space")
ALL_CHECKS: tuple[str, ...] = MANDATORY_CHECKS + OPTIONAL_CHECKS


# --------------------------------------------------------------------------- fleet


class Health(BaseModel):
    cpu_pct: float
    mem_pct: float
    latency_ms: float
    baseline_latency_ms: float
    error_rate: float

    @property
    def latency_ratio(self) -> float:
        return self.latency_ms / self.baseline_latency_ms if self.baseline_latency_ms else 1.0


class Patch(BaseModel):
    id: str
    title: str
    os_family: str
    cvss: float = Field(ge=0, le=10)
    known_exploited: bool = False
    released_days_ago: int = Field(ge=0)
    requires_restart: bool = True
    hold_versions: list[str] = Field(default_factory=list)
    hold_reason: str = ""


class Machine(BaseModel):
    id: str
    hostname: str
    os_family: str
    os_version: str
    role: str
    exposure: Exposure
    criticality: int = Field(ge=1, le=5)
    patch_id: str
    patch_status: PatchStatus
    checks: dict[str, CheckStatus]
    restart_required: bool
    telemetry_present: bool
    health: Health
    days_since_last_patch: int = Field(ge=0)
    synthetic: bool = True


# --------------------------------------------------------------------------- scoring config


class ScoringConfig(BaseModel):
    """Every number the risk engine uses lives here so it can be inspected and changed."""

    w_severity: float = Field(0.40, ge=0)
    w_exposure: float = Field(0.25, ge=0)
    w_criticality: float = Field(0.15, ge=0)
    w_age: float = Field(0.20, ge=0)
    exploited_bonus: float = Field(0.15, ge=0, le=1)
    exposure_values: dict[str, float] = Field(
        default_factory=lambda: {"internet": 1.0, "internal": 0.5, "isolated": 0.2}
    )
    age_saturation_days: int = Field(60, ge=1, le=730)
    band_critical: float = Field(70, ge=0, le=100)
    band_high: float = Field(55, ge=0, le=100)
    band_medium: float = Field(35, ge=0, le=100)
    # Weights for the *uncertainty* index (unknown evidence), independent of urgency.
    uncertainty_weight_mandatory: float = Field(1.0, ge=0)
    uncertainty_weight_optional: float = Field(0.5, ge=0)
    uncertainty_weight_telemetry: float = Field(1.5, ge=0)
    caution_uncertainty: float = Field(0.10, ge=0, le=1)
    # Pre-update health gate.
    health_latency_ratio_max: float = Field(1.5, ge=1)
    health_error_rate_max: float = Field(0.03, ge=0, le=1)
    require_telemetry: bool = True
    manual_approval_families: list[str] = Field(default_factory=lambda: ["ICS/Embedded"])

    @model_validator(mode="after")
    def _validate(self) -> "ScoringConfig":
        if self.w_severity + self.w_exposure + self.w_criticality + self.w_age <= 0:
            raise ValueError("at least one urgency weight must be positive")
        if not (self.band_medium <= self.band_high <= self.band_critical):
            raise ValueError("bands must satisfy medium <= high <= critical")
        for k in ("internet", "internal", "isolated"):
            v = self.exposure_values.get(k)
            if v is None or not 0 <= v <= 1:
                raise ValueError(f"exposure_values[{k}] must be present and within 0..1")
        return self


# --------------------------------------------------------------------------- assessment


class Component(BaseModel):
    name: str
    raw: float  # 0..1 normalised input
    weight: float  # normalised weight (sums to 1)
    points: float  # contribution to the 0..100 urgency score
    note: str


class Urgency(BaseModel):
    score: float
    band: Literal["critical", "high", "medium", "low"]
    components: list[Component]


class Finding(BaseModel):
    code: str
    message: str


class Assessment(BaseModel):
    machine_id: str
    urgency: Urgency
    compatibility_risk: float  # evidence of *negative* results, 0..1
    uncertainty: float  # *missing* evidence, 0..1 — tracked separately from risk
    readiness: Readiness
    blockers: list[Finding]
    warnings: list[Finding]
    action: Action
    summary: str
    reasons: list[str]


# --------------------------------------------------------------------------- rollout


class FaultInjection(BaseModel):
    """Simulated fault: machines matching the selector fail with `probability`."""

    kind: FaultKind = "error_spike"
    probability: float = Field(0.3, ge=0, le=1)
    os_family: str | None = None
    exposure: Exposure | None = None
    min_criticality: int | None = Field(None, ge=1, le=5)
    label: str = "injected fault"

    def matches(self, m: Machine) -> bool:
        return (
            (self.os_family is None or m.os_family == self.os_family)
            and (self.exposure is None or m.exposure == self.exposure)
            and (self.min_criticality is None or m.criticality >= self.min_criticality)
        )


class RolloutConfig(BaseModel):
    strategy: Strategy = "staged"
    batch_percents: list[float] = Field(default_factory=lambda: [5.0, 20.0, 35.0, 40.0])
    soak_minutes: int = Field(30, ge=0, le=1440)
    deploy_base_minutes: int = Field(5, ge=0, le=240)
    minutes_per_wave: int = Field(4, ge=0, le=120)
    concurrency: int = Field(20, ge=1, le=500)
    max_latency_ratio: float = Field(1.5, ge=1.0, le=10.0)
    max_error_rate: float = Field(0.03, ge=0.0, le=1.0)
    canary_halt_on_any_failure: bool = True
    max_unhealthy_fraction: float = Field(0.10, ge=0.0, le=1.0)
    fail_closed_on_missing_telemetry: bool = True
    allow_caution: bool = True
    rollback_minutes: int = Field(20, ge=0, le=480)
    baseline_detect_minutes: int = Field(60, ge=0, le=1440)
    horizon_hours: int = Field(168, ge=1, le=2160)
    faults: list[FaultInjection] = Field(default_factory=list, max_length=10)
    base_failure_probability: float = Field(0.01, ge=0, le=1)

    @field_validator("batch_percents")
    @classmethod
    def _batches(cls, v: list[float]) -> list[float]:
        if not 1 <= len(v) <= 8:
            raise ValueError("between 1 and 8 batches are supported")
        if any(p <= 0 for p in v):
            raise ValueError("every batch percentage must be > 0")
        if abs(sum(v) - 100.0) > 0.5:
            raise ValueError(f"batch percentages must sum to 100 (got {sum(v):.2f})")
        return v


class RolloutEvent(BaseModel):
    seq: int
    minute: float
    kind: str
    batch: int | None = None
    machine_id: str | None = None
    rule: str | None = None
    message: str
    data: dict = Field(default_factory=dict)


class MachineResult(BaseModel):
    machine_id: str
    state: Literal["pending", "patched", "rolled_back", "undetected_degraded", "skipped", "deferred"] = "pending"
    patched_at: float | None = None
    rolled_back_at: float | None = None
    failed: bool = False  # ground truth in the simulation
    fault_kind: FaultKind | None = None
    unhealthy_detected: bool = False
    would_succeed: bool = True  # ground truth, used for "unnecessary delay" accounting


class BatchPlan(BaseModel):
    index: int
    label: str
    machine_ids: list[str]


class BatchResult(BaseModel):
    index: int
    label: str
    start_minute: float
    end_minute: float
    size: int
    unhealthy: int
    unverifiable: int
    unhealthy_fraction: float
    passed: bool
    reason: str


class Deferred(BaseModel):
    machine_id: str
    readiness: Readiness
    codes: list[str]


class RolloutState(BaseModel):
    id: int | None = None
    strategy: Strategy
    scenario_id: str = "none"
    seed: int = 2026
    config: RolloutConfig
    status: RolloutStatus = "planned"
    batches: list[BatchPlan] = Field(default_factory=list)
    next_batch: int = 0
    clock: float = 0.0
    deferred: list[Deferred] = Field(default_factory=list)
    results: dict[str, MachineResult] = Field(default_factory=dict)
    batch_results: list[BatchResult] = Field(default_factory=list)
    events: list[RolloutEvent] = Field(default_factory=list)
    halt_reason: str | None = None
    breach_seen: bool = False
    persisted_events: int = 0  # how many events were already written to the audit log


class Scenario(BaseModel):
    id: str
    name: str
    description: str
    expectation: str
