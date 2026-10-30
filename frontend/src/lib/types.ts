export type Readiness = "ready" | "ready_with_caution" | "needs_approval" | "insufficient_evidence" | "blocked" | "compliant";
export type Band = "critical" | "high" | "medium" | "low";
export type CheckStatus = "pass" | "fail" | "unknown";
export type Strategy = "staged" | "all_at_once";
export type FaultKind = "boot_failure" | "latency_regression" | "error_spike" | "subtle_regression";

export interface Health { cpu_pct: number; mem_pct: number; latency_ms: number; baseline_latency_ms: number; error_rate: number }

export interface FleetItem {
  id: string; hostname: string; os_family: string; os_version: string; role: string;
  exposure: "internet" | "internal" | "isolated"; criticality: number; patch_id: string;
  patch_status: "pending" | "compliant"; checks: Record<string, CheckStatus>; restart_required: boolean;
  telemetry_present: boolean; health: Health; days_since_last_patch: number;
  urgency: number; band: Band; readiness: Readiness; action: string;
  compatibility_risk: number; uncertainty: number; blocker_codes: string[];
}

export interface Component { name: string; raw: number; weight: number; points: number; note: string }
export interface Finding { code: string; message: string }
export interface Assessment {
  machine_id: string; urgency: { score: number; band: Band; components: Component[] };
  compatibility_risk: number; uncertainty: number; readiness: Readiness; blockers: Finding[]; warnings: Finding[];
  action: string; summary: string; reasons: string[];
}
export interface Patch {
  id: string; title: string; os_family: string; cvss: number; known_exploited: boolean; released_days_ago: number;
  requires_restart: boolean; hold_versions: string[]; hold_reason: string;
}
export interface MachineDetailT { machine: Omit<FleetItem, "urgency" | "band" | "readiness" | "action" | "compatibility_risk" | "uncertainty" | "blocker_codes">; patch: Patch; assessment: Assessment }

export interface Dashboard {
  meta: { seed: number; size: number };
  totals: { machines: number; pending: number; compliant: number; restart_required: number; no_telemetry: number; degraded: number };
  os_distribution: { name: string; value: number }[];
  readiness: { name: Readiness; value: number }[];
  risk_bands: { name: Band; value: number }[];
  outstanding_patches: { patch_id: string; title: string; cvss: number; known_exploited: boolean; machines: number }[];
  priority_queue: { machine_id: string; hostname: string; urgency: number; band: Band; action: string }[];
  stuck_urgent: { machine_id: string; hostname: string; urgency: number; band: Band; readiness: Readiness; blockers: string[] }[];
  recent_activity: AuditEvent[];
  disclaimer: string;
}

export interface ScoringConfig {
  w_severity: number; w_exposure: number; w_criticality: number; w_age: number; exploited_bonus: number;
  exposure_values: Record<string, number>; age_saturation_days: number; band_critical: number; band_high: number; band_medium: number;
  uncertainty_weight_mandatory: number; uncertainty_weight_optional: number; uncertainty_weight_telemetry: number;
  caution_uncertainty: number; health_latency_ratio_max: number; health_error_rate_max: number; require_telemetry: boolean;
  manual_approval_families: string[];
}

export interface FaultInjection {
  kind: FaultKind; probability: number; os_family: string | null; exposure: string | null; min_criticality: number | null; label: string;
}
export interface RolloutConfig {
  strategy: Strategy; batch_percents: number[]; soak_minutes: number; deploy_base_minutes: number; minutes_per_wave: number;
  concurrency: number; max_latency_ratio: number; max_error_rate: number; canary_halt_on_any_failure: boolean;
  max_unhealthy_fraction: number; fail_closed_on_missing_telemetry: boolean; allow_caution: boolean; rollback_minutes: number;
  baseline_detect_minutes: number; horizon_hours: number; faults: FaultInjection[]; base_failure_probability: number;
}
export interface RolloutEvent { seq: number; minute: number; kind: string; batch: number | null; machine_id: string | null; rule: string | null; message: string; data: Record<string, unknown> }
export interface BatchPlan { index: number; label: string; machine_ids: string[] }
export interface BatchResult { index: number; label: string; start_minute: number; end_minute: number; size: number; unhealthy: number; unverifiable: number; unhealthy_fraction: number; passed: boolean; reason: string }
export interface MachineResult { machine_id: string; state: string; patched_at: number | null; rolled_back_at: number | null; failed: boolean; fault_kind: FaultKind | null; would_succeed: boolean }
export interface RolloutState {
  id: number; strategy: Strategy; scenario_id: string; seed: number; config: RolloutConfig;
  status: "planned" | "running" | "completed" | "halted" | "aborted";
  batches: BatchPlan[]; next_batch: number; clock: number; deferred: { machine_id: string; readiness: Readiness; codes: string[] }[];
  results: Record<string, MachineResult>; batch_results: BatchResult[]; events: RolloutEvent[]; halt_reason: string | null;
}
export interface Metrics {
  strategy: Strategy; status: string; in_scope: number; deployed: number; deferred_by_gate: number; skipped_after_halt: number;
  patched_successfully: number; completion_fraction: number; completion_minutes: number; blast_radius: number; blast_radius_weighted: number;
  blast_radius_fraction: number; rolled_back: number; undetected_degraded: number; unpatched_exposure: number; unnecessary_delays: number;
  unnecessary_delays_gate: number; unnecessary_delays_halt: number; unnecessary_delay_hours: number; safety_violations: number;
  safety_violation_rules: Record<string, number>; halted: boolean; halt_reason: string | null;
}
export interface TimelinePoint { minute: number; patched: number; rolled_back: number; impacted: number }
export interface ExposurePoint { hour: number; exposure: number }
export interface RolloutView { state: RolloutState; metrics: Metrics; timeline: TimelinePoint[]; exposure_curve: ExposurePoint[] }

export interface Scenario { id: string; name: string; description: string; expectation: string }
export interface Stat { mean: number; min: number; max: number }
export type StrategySummary = Record<string, Stat | number> & { halted_trials: number };
export interface Representative { metrics: Metrics; timeline: TimelinePoint[]; exposure_curve: ExposurePoint[]; batch_results: BatchResult[]; events: RolloutEvent[]; halt_reason: string | null }
export interface ExperimentSummary { id: number; created_at: string; scenario_id: string; seed: number; trials: number; summary: Record<Strategy, StrategySummary> }
export interface ExperimentResult extends ExperimentSummary { representative: Record<Strategy, Representative>; disclaimer: string }

export interface AuditEvent {
  id: number; ts: string; category: string; action: string; subject: string | null; rule: string | null;
  detail: Record<string, unknown>; rollout_id: number | null; experiment_id: number | null; sim_minute: number | null;
}
export interface SourceItem {
  id: string; vendor: string; approach: string; strengths: string[]; limitations: string[]; links: { title: string; url: string }[]; note?: string;
}
