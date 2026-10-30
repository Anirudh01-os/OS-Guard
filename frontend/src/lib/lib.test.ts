import { describe, expect, it } from "vitest";
import { describeError } from "./api";
import { minutesToText, pct, urgencyColor } from "./format";
import { flatten, layoutFleet } from "./layout";
import { normalizePercents, validateRollout, validateScoring } from "./validation";
import type { RolloutConfig, ScoringConfig } from "./types";

const rollout = (over: Partial<RolloutConfig> = {}): RolloutConfig => ({
  strategy: "staged", batch_percents: [5, 20, 35, 40], soak_minutes: 30, deploy_base_minutes: 5, minutes_per_wave: 4, concurrency: 20,
  max_latency_ratio: 1.5, max_error_rate: 0.03, canary_halt_on_any_failure: true, max_unhealthy_fraction: 0.1,
  fail_closed_on_missing_telemetry: true, allow_caution: true, rollback_minutes: 20, baseline_detect_minutes: 60, horizon_hours: 168,
  faults: [], base_failure_probability: 0.01, ...over,
});

describe("rollout validation", () => {
  it("accepts the defaults", () => expect(validateRollout(rollout())).toEqual([]));
  it("rejects batches that do not sum to 100", () => {
    expect(validateRollout(rollout({ batch_percents: [10, 20] }))[0]).toMatch(/sum to 100/);
  });
  it("rejects zero/negative batches and too many batches", () => {
    expect(validateRollout(rollout({ batch_percents: [0, 100] })).join()).toMatch(/greater than 0/);
    expect(validateRollout(rollout({ batch_percents: Array(9).fill(100 / 9) })).join()).toMatch(/between 1 and 8/);
  });
  it("rejects out-of-range thresholds and fault probabilities", () => {
    expect(validateRollout(rollout({ max_latency_ratio: 0.5 })).length).toBe(1);
    const f = { kind: "error_spike" as const, probability: 2, os_family: null, exposure: null, min_criticality: null, label: "x" };
    expect(validateRollout(rollout({ faults: [f] })).join()).toMatch(/Fault 1/);
  });
  it("normalizePercents always returns a valid total", () => {
    const n = normalizePercents([1, 1, 1]);
    expect(Math.abs(n.reduce((a, b) => a + b, 0) - 100)).toBeLessThan(0.01);
    expect(normalizePercents([0, 0]).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("scoring validation", () => {
  const base = { w_severity: 0.4, w_exposure: 0.25, w_criticality: 0.15, w_age: 0.2, band_critical: 70, band_high: 55, band_medium: 35, health_latency_ratio_max: 1.5 } as ScoringConfig;
  it("accepts defaults and rejects bad bands / zero weights", () => {
    expect(validateScoring(base)).toEqual([]);
    expect(validateScoring({ ...base, band_medium: 90 }).length).toBe(1);
    expect(validateScoring({ ...base, w_severity: 0, w_exposure: 0, w_criticality: 0, w_age: 0 }).length).toBe(1);
  });
});

describe("format helpers", () => {
  it("formats durations and percentages", () => {
    expect(minutesToText(0)).toBe("0m");
    expect(minutesToText(95)).toBe("1h 35m");
    expect(minutesToText(3000)).toBe("2d 2h");
    expect(pct(0.256, 1)).toBe("25.6%");
  });
  it("maps urgency to bands consistently with the backend defaults", () => {
    expect(urgencyColor(80)).not.toBe(urgencyColor(10));
    expect(urgencyColor(70)).toBe(urgencyColor(99));
  });
});

describe("api error formatting", () => {
  it("flattens pydantic detail arrays", () => {
    const msg = describeError({ detail: [{ loc: ["body", "config", "batch_percents"], msg: "must sum to 100" }] }, "x");
    expect(msg).toBe("config.batch_percents: must sum to 100");
    expect(describeError({ detail: "nope" }, "x")).toBe("nope");
    expect(describeError(null, "fallback")).toBe("fallback");
  });
});

describe("fleet layout", () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ id: `vm-${String(i).padStart(3, "0")}`, os_family: ["A", "B", "C", "D"][i % 4] }));
  it("is deterministic and finite", () => {
    const a = layoutFleet(items), b = layoutFleet([...items].reverse());
    expect(a).toEqual(b);
    expect(a.nodes).toHaveLength(60);
    expect(a.nodes.every((n) => [n.x, n.y, n.z].every(Number.isFinite))).toBe(true);
  });
  it("connects every node and keeps edges in range", () => {
    const l = layoutFleet(items);
    const touched = new Set(l.edges.flat());
    expect(touched.size).toBe(60);
    expect(l.edges.every(([a, b]) => a < 60 && b < 60 && a !== b)).toBe(true);
  });
  it("flattens into the 0..100 box", () => {
    const f = flatten(layoutFleet(items));
    expect(f.every((p) => p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100)).toBe(true);
  });
});
