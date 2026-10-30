import type { Band, Readiness } from "./types";

export const READINESS_COLOR: Record<Readiness, string> = {
  ready: "#4ade80",
  ready_with_caution: "#a3e635",
  needs_approval: "#7aa7ff",
  insufficient_evidence: "#fbbf24",
  blocked: "#fb7185",
  compliant: "#475569",
};
export const READINESS_LABEL: Record<Readiness, string> = {
  ready: "Ready",
  ready_with_caution: "Ready · caution",
  needs_approval: "Needs approval",
  insufficient_evidence: "Insufficient evidence",
  blocked: "Blocked",
  compliant: "Compliant",
};
export const BAND_COLOR: Record<Band, string> = { critical: "#ff4d6d", high: "#fb923c", medium: "#fbbf24", low: "#64d6c4" };

export const ACTION_LABEL: Record<string, string> = {
  no_action: "No action",
  deploy_expedited: "Deploy · expedited canary",
  deploy_staged: "Deploy · staged",
  deploy_staged_caution: "Deploy · staged (late, watch)",
  request_approval: "Request approval",
  collect_evidence: "Collect evidence",
  resolve_blockers: "Resolve blockers",
  escalate_mitigate: "Escalate & mitigate",
};

export const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
export const num = (v: number, digits = 1) => (Number.isInteger(v) ? String(v) : v.toFixed(digits));

/** 95 -> "1h 35m"; 3000 -> "2d 2h" */
export function minutesToText(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return "0m";
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = Math.round(min % 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Colour for a 0..100 urgency score, matching the backend's default bands. */
export function urgencyColor(score: number): string {
  if (score >= 70) return BAND_COLOR.critical;
  if (score >= 55) return BAND_COLOR.high;
  if (score >= 35) return BAND_COLOR.medium;
  return BAND_COLOR.low;
}
