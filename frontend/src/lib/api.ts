import type {
  Assessment, AuditEvent, Dashboard, ExperimentResult, ExperimentSummary, FleetItem, MachineDetailT, RolloutConfig,
  RolloutView, Scenario, ScoringConfig, SourceItem,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Turn FastAPI/pydantic error payloads into one readable sentence. */
export function describeError(body: unknown, fallback: string): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d: { loc?: (string | number)[]; msg?: string }) => `${(d.loc ?? []).filter((p) => p !== "body").join(".")}: ${d.msg ?? "invalid"}`)
      .join("; ");
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  } catch {
    throw new ApiError("Cannot reach the OSGuard API. Is the backend running on port 8000?", 0);
  }
  if (!res.ok) {
    let body: unknown = null;
    try { body = await res.json(); } catch { /* non-JSON error */ }
    throw new ApiError(describeError(body, `Request failed (${res.status})`), res.status);
  }
  return (await res.json()) as T;
}

const qs = (p: Record<string, string | number | undefined | null>) => {
  const u = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") u.set(k, String(v)); });
  const s = u.toString();
  return s ? `?${s}` : "";
};
const post = <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export interface FleetQuery { search?: string; os_family?: string; exposure?: string; readiness?: string; criticality?: number | ""; sort?: string; order?: string; limit?: number }
export interface AuditQuery { category?: string; q?: string; rollout_id?: number | ""; experiment_id?: number | ""; limit?: number; offset?: number }

export const api = {
  health: () => request<{ status: string; machines: number }>("/api/health"),
  dashboard: () => request<Dashboard>("/api/dashboard"),
  fleet: (q: FleetQuery = {}) => request<{ total: number; items: FleetItem[] }>(`/api/fleet${qs({ limit: 500, ...q })}`),
  machine: (id: string) => request<MachineDetailT>(`/api/fleet/${encodeURIComponent(id)}`),
  reseed: (seed: number, size: number) => post<{ seed: number; size: number }>("/api/fleet/reseed", { seed, size }),
  scoring: () => request<ScoringConfig>("/api/config/scoring"),
  saveScoring: (cfg: ScoringConfig) => request<ScoringConfig>("/api/config/scoring", { method: "PUT", body: JSON.stringify(cfg) }),
  resetScoring: () => post<ScoringConfig>("/api/config/scoring/reset"),
  rolloutDefaults: () => request<RolloutConfig>("/api/config/rollout-defaults"),
  scenarios: () => request<Scenario[]>("/api/scenarios"),
  createRollout: (config: RolloutConfig, scenario_id: string, seed: number, run = false) =>
    post<RolloutView["state"]>("/api/rollouts", { config, scenario_id, seed, run }),
  rollout: (id: number) => request<RolloutView>(`/api/rollouts/${id}`),
  rollouts: () => request<{ id: number; created_at: string; strategy: string; scenario_id: string; status: string }[]>("/api/rollouts"),
  advance: (id: number) => post<RolloutView>(`/api/rollouts/${id}/advance`),
  abort: (id: number) => post<RolloutView>(`/api/rollouts/${id}/abort`),
  runExperiment: (scenario_id: string, seed: number, trials: number, config?: RolloutConfig) =>
    post<ExperimentResult>("/api/experiments", { scenario_id, seed, trials, ...(config ? { config } : {}) }),
  experiments: () => request<ExperimentSummary[]>("/api/experiments"),
  experiment: (id: number) => request<ExperimentResult>(`/api/experiments/${id}`),
  analytics: () => request<{ scenarios: Scenario[]; latest: ExperimentSummary[]; disclaimer: string }>("/api/analytics"),
  audit: (q: AuditQuery = {}) => request<{ total: number; items: AuditEvent[]; categories: string[] }>(`/api/audit${qs({ limit: 50, ...q })}`),
  auditExportUrl: (format: "csv" | "json", q: AuditQuery = {}) => `/api/audit/export${qs({ format, category: q.category, q: q.q, rollout_id: q.rollout_id, experiment_id: q.experiment_id })}`,
  sources: () => request<{ sources: SourceItem[]; libraries: { name: string; license: string }[]; verification: string }>("/api/sources"),
};
export type { Assessment };
