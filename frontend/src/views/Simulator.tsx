import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, chartTooltipStyle, Empty, ErrorBox, Field, MagneticButton, NumberInput, Panel, Segmented, Select, SyntheticTag, Toggle, cx, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { minutesToText, pct, titleCase } from "../lib/format";
import type { FaultInjection, RolloutConfig, RolloutView, TimelinePoint } from "../lib/types";
import { normalizePercents, validateRollout } from "../lib/validation";

const STATUS_COLOR: Record<string, string> = { planned: "#7aa7ff", running: "#3de8ff", completed: "#4ade80", halted: "#fb7185", aborted: "#fbbf24" };
const EVENT_COLOR: Record<string, string> = {
  PLAN: "#7aa7ff", MACHINE_DEFERRED: "#fbbf24", BATCH_STARTED: "#3de8ff", SOAK_STARTED: "#64748b", HEALTH_CHECK: "#a78bfa",
  BATCH_PASSED: "#4ade80", ROLLOUT_COMPLETED: "#4ade80", ROLLOUT_HALTED: "#fb7185", MACHINE_ROLLED_BACK: "#fb923c",
  ROLLOUT_ABORTED: "#fbbf24", FAILURE_DETECTED: "#fb923c",
};

function mergeTimelines(a: TimelinePoint[], b: TimelinePoint[] | null) {
  const minutes = [...new Set([...a.map((p) => p.minute), ...(b ?? []).map((p) => p.minute)])].sort((x, y) => x - y);
  const at = (arr: TimelinePoint[], m: number) => arr.filter((p) => p.minute <= m).at(-1);
  return minutes.map((m) => {
    const pa = at(a, m), pb = b ? at(b, m) : undefined;
    return { minute: m, staged: pa?.patched ?? 0, stagedImpacted: pa?.impacted ?? 0, base: pb?.patched, baseImpacted: pb?.impacted };
  });
}

export default function Simulator() {
  const defaults = useAsync(() => api.rolloutDefaults(), []);
  const scenarios = useAsync(() => api.scenarios(), []);
  const history = useAsync(() => api.rollouts(), []);
  const facets = useAsync(async () => (await fetch("/api/fleet/facets")).json() as Promise<{ os_family: string[] }>, []);
  const [cfg, setCfg] = useState<RolloutConfig | null>(null);
  const [scenario, setScenario] = useState("none");
  const [seed, setSeed] = useState(2026);
  const [view, setView] = useState<RolloutView | null>(null);
  const [baseline, setBaseline] = useState<RolloutView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [logMode, setLogMode] = useState<"decisions" | "all">("decisions");
  useEffect(() => { if (defaults.data) setCfg(defaults.data); }, [defaults.data]);

  const errors = useMemo(() => (cfg ? validateRollout(cfg) : []), [cfg]);
  if (defaults.error) return <ErrorBox error={defaults.error} onRetry={defaults.reload} />;
  if (!cfg) return <Panel><div className="text-sm text-slate-400">Loading defaults…</div></Panel>;
  const upd = (p: Partial<RolloutConfig>) => setCfg({ ...cfg, ...p });
  const sum = cfg.batch_percents.reduce((a, b) => a + b, 0);

  const guarded = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setErr(null);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const create = (run: boolean) => guarded(run ? "run" : "create", async () => {
    const st = await api.createRollout({ ...cfg, strategy: "staged" }, scenario, seed, run);
    setBaseline(null);
    setView(await api.rollout(st.id));
    history.reload();
  });
  const createBaseline = () => guarded("baseline", async () => {
    const st = await api.createRollout({ ...cfg, strategy: "all_at_once" }, scenario, seed, true);
    setBaseline(await api.rollout(st.id));
    history.reload();
  });
  const advance = () => view && guarded("advance", async () => { setView(await api.advance(view.state.id)); history.reload(); });
  const abort = () => view && guarded("abort", async () => { setView(await api.abort(view.state.id)); history.reload(); });
  const load = (id: string) => guarded("load", async () => { setBaseline(null); setView(await api.rollout(Number(id))); });

  const st = view?.state;
  const terminal = st && ["completed", "halted", "aborted"].includes(st.status);
  const events = st ? st.events.filter((e) => logMode === "all" || e.kind !== "MACHINE_PATCHED") : [];
  const setFault = (i: number, p: Partial<FaultInjection>) => upd({ faults: cfg.faults.map((f, j) => (j === i ? { ...f, ...p } : f)) });

  return (
    <div className="grid gap-5 xl:grid-cols-5">
      <div className="space-y-5 xl:col-span-2">
        <Panel title="Rollout configuration" subtitle="Nothing here touches a real system – the simulation applies a documented failure model.">
          <div className="space-y-4">
            <Field label="Scenario">
              <Select ariaLabel="Scenario" value={scenario} onChange={setScenario} options={[{ value: "none", label: "None – current fleet as stored" }, ...(scenarios.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
            </Field>
            {scenario !== "none" && <p className="rounded-lg bg-white/[0.03] p-2.5 text-xs text-slate-400">{scenarios.data?.find((s) => s.id === scenario)?.description}</p>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Outcome seed" hint="Same seed → identical result"><NumberInput value={seed} onChange={setSeed} min={0} ariaLabel="Seed" /></Field>
              <Field label="Soak (min)" hint="Wait before health check"><NumberInput value={cfg.soak_minutes} onChange={(v) => upd({ soak_minutes: v })} min={0} max={1440} ariaLabel="Soak minutes" /></Field>
            </div>

            <div>
              <div className="flex items-center justify-between"><span className="label">Batches (% of eligible machines)</span><span className={cx("num text-xs", Math.abs(sum - 100) > 0.5 ? "text-bad" : "text-ok")}>Σ {sum.toFixed(1)}%</span></div>
              <div className="mt-2 flex flex-wrap gap-2">
                {cfg.batch_percents.map((p, i) => (
                  <div key={i} className="w-[86px]">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">{i === 0 ? "Canary" : `Stage ${i}`}</div>
                    <div className="flex items-center gap-1">
                      <NumberInput value={p} min={0.1} max={100} step={0.5} ariaLabel={`Batch ${i + 1} percent`} onChange={(v) => upd({ batch_percents: cfg.batch_percents.map((x, j) => (j === i ? v : x)) })} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="btn" disabled={cfg.batch_percents.length >= 8} onClick={() => upd({ batch_percents: normalizePercents([...cfg.batch_percents, 10]) })}>+ Batch</button>
                <button className="btn" disabled={cfg.batch_percents.length <= 1} onClick={() => upd({ batch_percents: normalizePercents(cfg.batch_percents.slice(0, -1)) })}>− Batch</button>
                <button className="btn" onClick={() => upd({ batch_percents: normalizePercents(cfg.batch_percents) })}>Rebalance to 100</button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Max latency ×"><NumberInput value={cfg.max_latency_ratio} onChange={(v) => upd({ max_latency_ratio: v })} min={1} step={0.1} ariaLabel="Max latency ratio" /></Field>
              <Field label="Max error rate"><NumberInput value={cfg.max_error_rate} onChange={(v) => upd({ max_error_rate: v })} min={0} max={1} step={0.005} ariaLabel="Max error rate" /></Field>
              <Field label="Batch tolerance"><NumberInput value={cfg.max_unhealthy_fraction} onChange={(v) => upd({ max_unhealthy_fraction: v })} min={0} max={1} step={0.05} ariaLabel="Unhealthy fraction tolerance" /></Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Toggle checked={cfg.canary_halt_on_any_failure} onChange={(v) => upd({ canary_halt_on_any_failure: v })} label="Halt on any canary failure" />
              <Toggle checked={cfg.fail_closed_on_missing_telemetry} onChange={(v) => upd({ fail_closed_on_missing_telemetry: v })} label="Fail closed w/o telemetry" />
              <Toggle checked={cfg.allow_caution} onChange={(v) => upd({ allow_caution: v })} label="Include ‘ready with caution’" />
            </div>

            <div>
              <div className="flex items-center justify-between"><span className="label">Fault injection</span>
                <button className="btn" disabled={cfg.faults.length >= 10} onClick={() => upd({ faults: [...cfg.faults, { kind: "error_spike", probability: 0.3, os_family: null, exposure: null, min_criticality: null, label: "injected fault" }] })}>+ Add fault</button></div>
              {cfg.faults.length === 0 && <p className="mt-2 text-xs text-slate-500">No injected faults. Only the background failure model applies.</p>}
              <ul className="mt-2 space-y-2">
                {cfg.faults.map((f, i) => (
                  <li key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
                    <Select ariaLabel="Fault kind" value={f.kind} onChange={(v) => setFault(i, { kind: v as FaultInjection["kind"] })}
                      options={["boot_failure", "latency_regression", "error_spike", "subtle_regression"].map((k) => ({ value: k, label: titleCase(k) }))} />
                    <NumberInput value={f.probability} onChange={(v) => setFault(i, { probability: v })} min={0} max={1} step={0.05} ariaLabel="Fault probability" />
                    <Select ariaLabel="Target OS" value={f.os_family ?? ""} onChange={(v) => setFault(i, { os_family: v || null })} options={[{ value: "", label: "Any OS" }, ...(facets.data?.os_family ?? []).map((o) => ({ value: o, label: o }))]} />
                    <div className="flex gap-2">
                      <Select ariaLabel="Min criticality" value={String(f.min_criticality ?? "")} onChange={(v) => setFault(i, { min_criticality: v ? Number(v) : null })} options={[{ value: "", label: "Any crit." }, ...[2, 3, 4, 5].map((n) => ({ value: String(n), label: `crit ≥ ${n}` }))]} />
                      <button className="btn btn-danger" aria-label="Remove fault" onClick={() => upd({ faults: cfg.faults.filter((_, j) => j !== i) })}>✕</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {errors.length > 0 && <ul role="alert" className="space-y-1 text-xs text-rose-300">{errors.map((e) => <li key={e}>• {e}</li>)}</ul>}
            {err && <ErrorBox error={err} />}
            <div className="flex flex-wrap gap-2">
              <MagneticButton variant="primary" disabled={errors.length > 0 || !!busy} onClick={() => create(false)}>{busy === "create" ? "Planning…" : "Plan rollout"}</MagneticButton>
              <MagneticButton disabled={errors.length > 0 || !!busy} onClick={() => create(true)}>{busy === "run" ? "Running…" : "Plan & run to end"}</MagneticButton>
              <MagneticButton onClick={() => { setCfg(defaults.data); setScenario("none"); }}>Reset</MagneticButton>
            </div>
          </div>
        </Panel>

        <Panel title="Previous rollouts" subtitle="Persisted in SQLite">
          {!history.data?.length ? <Empty title="No rollouts yet" hint="Plan one above." /> : (
            <Select ariaLabel="Load rollout" value={String(st?.id ?? "")} onChange={load}
              options={[{ value: "", label: "Load a rollout…" }, ...history.data.map((r) => ({ value: String(r.id), label: `#${r.id} · ${r.strategy} · ${r.scenario_id} · ${r.status}` }))]} />
          )}
        </Panel>
      </div>

      <div className="space-y-5 xl:col-span-3">
        {!view || !st ? (
          <Panel title="Rollout" subtitle="Plan a rollout to see batches, health checks and recorded decisions.">
            <Empty title="No rollout selected" hint="Configure on the left, then ‘Plan rollout’ to step through batches manually, or ‘Plan & run to end’." />
          </Panel>
        ) : (
          <>
            <Panel title={<span className="flex flex-wrap items-center gap-2">Rollout #{st.id} <Badge color={STATUS_COLOR[st.status]}>{st.status}</Badge> <Badge color="#94a3b8">{st.strategy === "staged" ? "staged" : "all-at-once baseline"}</Badge> <SyntheticTag /></span>}
              subtitle={st.halt_reason ? `Stopped: ${st.halt_reason}` : `Simulated clock ${minutesToText(st.clock)} · scenario ${st.scenario_id} · seed ${st.seed}`}
              actions={<>
                <MagneticButton variant="primary" disabled={!!terminal || !!busy} onClick={advance}>{busy === "advance" ? "Running batch…" : "Advance next batch"}</MagneticButton>
                <MagneticButton variant="danger" disabled={!!terminal || !!busy} onClick={abort}>Abort</MagneticButton>
                <MagneticButton disabled={!!busy || st.strategy !== "staged"} onClick={createBaseline}>{busy === "baseline" ? "Simulating…" : baseline ? "Re-run baseline" : "Compare with all-at-once"}</MagneticButton>
              </>}>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {st.batches.map((b) => {
                  const r = st.batch_results.find((x) => x.index === b.index);
                  const state = r ? (r.passed ? "passed" : "failed") : st.status === "halted" || st.status === "aborted" ? "skipped" : b.index === st.next_batch && st.status !== "completed" ? "next" : "pending";
                  const color = { passed: "#4ade80", failed: "#fb7185", skipped: "#475569", next: "#3de8ff", pending: "#64748b" }[state];
                  return (
                    <motion.div key={b.index} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="min-w-[132px] flex-1 rounded-xl border p-3" style={{ borderColor: `${color}66`, background: `${color}10` }}>
                      <div className="flex items-center justify-between"><span className="text-xs font-semibold text-slate-100">{b.label}</span><span className="text-[10px] uppercase tracking-wider" style={{ color }}>{state}</span></div>
                      <div className="num mt-1 text-2xl text-slate-100">{b.machine_ids.length}</div>
                      <div className="text-[11px] text-slate-400">{r ? `${r.unhealthy} unhealthy · ${pct(r.unhealthy_fraction)}` : "machines"}</div>
                    </motion.div>
                  );
                })}
                {st.batches.length === 0 && <Empty title="No deployable batches" hint="Every in-scope machine was deferred by the readiness gate." />}
              </div>
              {st.batch_results.length > 0 && <ul className="mt-3 space-y-1 text-xs text-slate-300">{st.batch_results.map((r) => <li key={r.index}><span className="text-slate-100">{r.label}:</span> {r.reason} <span className="text-slate-500">(ended {minutesToText(r.end_minute)})</span></li>)}</ul>}
            </Panel>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Metric label="Blast radius" value={view.metrics.blast_radius} sub={`weighted ${view.metrics.blast_radius_weighted}`} base={baseline?.metrics.blast_radius} />
              <Metric label="Patched OK" value={`${view.metrics.patched_successfully}/${view.metrics.in_scope}`} sub={pct(view.metrics.completion_fraction)} />
              <Metric label="Elapsed" value={minutesToText(view.metrics.completion_minutes)} base={baseline ? minutesToText(baseline.metrics.completion_minutes) : undefined} />
              <Metric label="Safety violations" value={view.metrics.safety_violations} base={baseline?.metrics.safety_violations} sub={Object.keys(view.metrics.safety_violation_rules).join(", ") || "none"} />
              <Metric label="Deferred by gate" value={view.metrics.deferred_by_gate} sub={`${view.metrics.unnecessary_delays_gate} would have succeeded`} />
              <Metric label="Skipped after halt" value={view.metrics.skipped_after_halt} />
              <Metric label="Rolled back" value={view.metrics.rolled_back} base={baseline?.metrics.rolled_back} />
              <Metric label="Exposure (urg·h)" value={view.metrics.unpatched_exposure.toFixed(0)} base={baseline?.metrics.unpatched_exposure.toFixed(0)} sub="simulated" />
            </div>
            {baseline && <p className="text-xs text-slate-500">Small figures beneath a value show the all-at-once baseline on the same fleet, scenario and seed. Simulation output only.</p>}

            <Panel title="Patched machines over simulated time" subtitle="Solid = staged · dashed = all-at-once baseline · red = deployed machines that are actually failing">
              <div className="h-60">
                <ResponsiveContainer>
                  <LineChart data={mergeTimelines(view.timeline, baseline?.timeline ?? null)} margin={{ left: -10, right: 10, top: 6 }}>
                    <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
                    <XAxis dataKey="minute" tickFormatter={(m) => minutesToText(m)} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip {...chartTooltipStyle} labelFormatter={(m) => `t = ${minutesToText(Number(m))}`} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="stepAfter" dataKey="staged" name="Patched (selected)" stroke="#3de8ff" dot={false} strokeWidth={2} />
                    <Line type="stepAfter" dataKey="stagedImpacted" name="Impacted (selected)" stroke="#fb7185" dot={false} strokeWidth={2} />
                    {baseline && <Line type="stepAfter" dataKey="base" name="Patched (baseline)" stroke="#3de8ff" strokeDasharray="4 4" dot={false} />}
                    {baseline && <Line type="stepAfter" dataKey="baseImpacted" name="Impacted (baseline)" stroke="#fb7185" strokeDasharray="4 4" dot={false} />}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Recorded decisions" subtitle={`${events.length} events · every one is also in the audit log`}
              actions={<Segmented value={logMode} onChange={setLogMode} options={[{ value: "decisions", label: "Decisions" }, { value: "all", label: "Everything" }]} />}>
              <ol className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
                <AnimatePresence initial={false}>
                  {events.map((e) => (
                    <motion.li key={e.seq} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex gap-3 rounded-lg bg-white/[0.025] px-3 py-2 text-xs">
                      <span className="num w-14 shrink-0 text-slate-500">{minutesToText(e.minute)}</span>
                      <span className="w-40 shrink-0"><Badge color={EVENT_COLOR[e.kind] ?? "#94a3b8"}>{e.kind}</Badge></span>
                      <span className="text-slate-300">{e.message}{e.rule && <span className="ml-2 text-slate-500">rule {e.rule}</span>}</span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ol>
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, sub, base }: { label: string; value: React.ReactNode; sub?: string; base?: React.ReactNode }) {
  return (
    <div className="panel px-4 py-3">
      <div className="label">{label}</div>
      <div className="num mt-1 text-xl font-semibold text-slate-100">{value}</div>
      {base !== undefined && <div className="num text-[11px] text-slate-400">baseline {base}</div>}
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}
