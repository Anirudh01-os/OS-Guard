import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Comparison, { BASE, STAGED } from "../components/Comparison";
import { Empty, ErrorBox, MagneticButton, Panel, Select, Skeleton, chartTooltipStyle, useAsync } from "../components/ui";
import { api } from "../lib/api";
import type { ExperimentResult } from "../lib/types";

const KEYS = [["blast_radius", "Blast radius"], ["safety_violations", "Safety violations"], ["unnecessary_delays", "Unnecessary delays"]] as const;

export default function Analytics({ go }: { go: (r: string) => void }) {
  const a = useAsync(() => api.analytics(), []);
  const [sel, setSel] = useState<string>("");
  const [detail, setDetail] = useState<ExperimentResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = a.data?.latest ?? [];
  const nameOf = (id: string) => a.data?.scenarios.find((s) => s.id === id)?.name ?? id;

  useEffect(() => { if (!sel && latest.length) setSel(String(latest[0].id)); }, [latest, sel]);
  useEffect(() => {
    if (!sel) return;
    let live = true;
    api.experiment(Number(sel)).then((r) => live && setDetail(r)).catch((e) => live && setErr(String(e.message ?? e)));
    return () => { live = false; };
  }, [sel]);

  const runAll = async () => {
    setBusy(true); setErr(null);
    try { for (const s of a.data?.scenarios ?? []) await api.runExperiment(s.id, 2026, 10); a.reload(); setSel(""); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  if (a.error) return <ErrorBox error={a.error} onRetry={a.reload} />;
  if (a.loading && !a.data) return <Skeleton className="h-96" />;
  if (!latest.length) return (
    <Panel title="Analytics"><Empty title="No experiment results yet" hint="Analytics compares the staged strategy with the all-at-once baseline using stored experiment runs."
      action={<div className="flex gap-2"><MagneticButton variant="primary" disabled={busy} onClick={runAll}>{busy ? "Running all scenarios…" : "Run all scenarios now"}</MagneticButton><button className="btn" onClick={() => go("lab")}>Open lab</button></div>} />
      {err && <div className="mt-3"><ErrorBox error={err} /></div>}</Panel>
  );

  const chart = latest.map((e) => ({
    name: nameOf(e.scenario_id),
    ...Object.fromEntries(KEYS.flatMap(([k]) => [[`s_${k}`, (e.summary.staged[k] as { mean: number }).mean], [`b_${k}`, (e.summary.all_at_once[k] as { mean: number }).mean]])),
  }));

  return (
    <div className="space-y-5">
      <Panel title="Strategy comparison" subtitle="Staged, evidence-gated rollout vs all-at-once baseline – latest experiment per scenario"
        actions={<><div className="w-64"><Select ariaLabel="Experiment" value={sel} onChange={setSel} options={latest.map((e) => ({ value: String(e.id), label: `#${e.id} · ${nameOf(e.scenario_id)}` }))} /></div>
          <MagneticButton disabled={busy} onClick={runAll}>{busy ? "Re-running…" : "Re-run all"}</MagneticButton></>}>
        <div className="grid gap-5 lg:grid-cols-3">
          {KEYS.map(([k, label]) => (
            <div key={k}>
              <div className="label mb-1">{label} (mean)</div>
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={chart} margin={{ left: 26, right: 6 }}>
                    <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 9 }} interval={0} angle={-30} textAnchor="end" height={84} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip {...chartTooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey={`s_${k}`} name="Staged" fill={STAGED} radius={[4, 4, 0, 0]} />
                    <Bar dataKey={`b_${k}`} name="All-at-once" fill={BASE} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
        {err && <div className="mt-3"><ErrorBox error={err} /></div>}
      </Panel>

      {detail ? <Comparison result={detail} name={nameOf(detail.scenario_id)} /> : <Skeleton className="h-64" />}

      <Panel title="How to read these numbers">
        <div className="grid gap-4 text-xs text-slate-300 md:grid-cols-2">
          <div><div className="label text-cyan-soft">Measured (in this simulation)</div><p className="mt-1">Counts and times produced by running both strategies over the same synthetic fleet and the same hidden per-machine outcomes. They are exactly reproducible from the seed.</p></div>
          <div><div className="label text-warn">Not measured (real world)</div><p className="mt-1">The failure model deliberately correlates failures with the recorded evidence, so gating looks good by construction. Real fleets contain failures no check predicts. Treat these results as a demonstration of the mechanism and trade-offs, not as evidence of real-world improvement.</p></div>
        </div>
      </Panel>
    </div>
  );
}
