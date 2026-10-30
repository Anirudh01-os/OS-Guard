import type { RolloutConfig, ScoringConfig } from "./types";

/** Client-side mirror of the backend validators so users get instant, specific feedback. */
export function validateRollout(c: RolloutConfig): string[] {
  const errs: string[] = [];
  const sum = c.batch_percents.reduce((a, b) => a + b, 0);
  if (c.batch_percents.length < 1 || c.batch_percents.length > 8) errs.push("Use between 1 and 8 batches.");
  if (c.batch_percents.some((p) => !(p > 0))) errs.push("Every batch percentage must be greater than 0.");
  if (Math.abs(sum - 100) > 0.5) errs.push(`Batch percentages must sum to 100 (currently ${sum.toFixed(1)}).`);
  if (c.soak_minutes < 0 || c.soak_minutes > 1440) errs.push("Soak time must be 0–1440 minutes.");
  if (c.max_latency_ratio < 1) errs.push("Latency ratio limit must be at least 1.0×.");
  if (c.max_error_rate < 0 || c.max_error_rate > 1) errs.push("Error-rate limit must be between 0 and 1.");
  if (c.max_unhealthy_fraction < 0 || c.max_unhealthy_fraction > 1) errs.push("Unhealthy-fraction tolerance must be between 0 and 1.");
  c.faults.forEach((f, i) => {
    if (f.probability < 0 || f.probability > 1) errs.push(`Fault ${i + 1}: probability must be within 0–1.`);
  });
  return errs;
}

export function validateScoring(c: ScoringConfig): string[] {
  const errs: string[] = [];
  if (c.w_severity + c.w_exposure + c.w_criticality + c.w_age <= 0) errs.push("At least one urgency weight must be positive.");
  if (!(c.band_medium <= c.band_high && c.band_high <= c.band_critical)) errs.push("Bands must satisfy medium ≤ high ≤ critical.");
  if (c.health_latency_ratio_max < 1) errs.push("Health latency limit must be at least 1.0×.");
  return errs;
}

/** Rebalance helper: scale a list so it sums to exactly 100 (rounded to 1 dp). */
export function normalizePercents(p: number[]): number[] {
  const s = p.reduce((a, b) => a + b, 0);
  if (s <= 0) return p.map(() => 100 / p.length);
  const scaled = p.map((x) => Math.round((x / s) * 1000) / 10);
  scaled[scaled.length - 1] = Math.round((100 - scaled.slice(0, -1).reduce((a, b) => a + b, 0)) * 10) / 10;
  return scaled;
}
