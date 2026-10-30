import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { minutesToText } from "../lib/format";
import type { ExperimentResult, Stat } from "../lib/types";
import { Panel, SyntheticTag, chartTooltipStyle } from "./ui";

export const STAGED = "#3de8ff";
export const BASE = "#fb923c";

const METRICS: { key: string; label: string; unit?: (v: number) => string; lowerBetter: boolean; hint: string }[] = [
  { key: "blast_radius", label: "Failure blast radius", lowerBetter: true, hint: "Machines that were updated and actually failed" },
  { key: "safety_violations", label: "Safety-rule violations", lowerBetter: true, hint: "Deployments that ignored a readiness rule" },
  { key: "unnecessary_delays", label: "Unnecessary delays", lowerBetter: true, hint: "Machines held back that would have succeeded" },
  { key: "completion_minutes", label: "Deployment completion time", unit: minutesToText, lowerBetter: true, hint: "Simulated minutes until the rollout stopped" },
  { key: "unpatched_exposure", label: "Simulated unpatched exposure", lowerBetter: true, hint: "Urgency-weighted machine-hours unprotected over the horizon" },
  { key: "completion_fraction", label: "Fleet patched", unit: (v) => `${(v * 100).toFixed(0)}%`, lowerBetter: false, hint: "Share of in-scope machines patched successfully" },
];

const stat = (s: unknown) => s as Stat;

export function MetricCards({ result }: { result: ExperimentResult }) {
  const st = result.summary.staged, bs = result.summary.all_at_once;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {METRICS.map((m) => {
        const a = stat(st[m.key]), b = stat(bs[m.key]);
        const fmt = m.unit ?? ((v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1)));
        const better = m.lowerBetter ? a.mean < b.mean : a.mean > b.mean;
        const tie = a.mean === b.mean;
        const data = [{ name: "Staged", v: a.mean, c: STAGED }, { name: "All-at-once", v: b.mean, c: BASE }];
        return (
          <div key={m.key} className="panel p-4">
            <div className="flex items-start justify-between gap-2">
              <div><div className="text-sm font-medium text-slate-100">{m.label}</div><div className="text-[11px] text-slate-500">{m.hint}</div></div>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${tie ? "bg-white/10 text-slate-300" : better ? "bg-ok/15 text-ok" : "bg-bad/15 text-bad"}`}>{tie ? "tie" : better ? "staged better" : "staged worse"}</span>
            </div>
            <div className="mt-2 h-24">
              <ResponsiveContainer>
                <BarChart data={data} layout="vertical" margin={{ left: 0, right: 44 }}>
                  <XAxis type="number" hide domain={[0, "dataMax"]} />
                  <YAxis type="category" dataKey="name" width={78} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip {...chartTooltipStyle} formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="v" isAnimationActive={false} radius={[0, 6, 6, 0]} barSize={18} label={{ position: "right", fill: "#cbd5e1", fontSize: 11, formatter: (v: number) => fmt(v) }}>
                    {data.map((d) => <Cell key={d.name} fill={d.c} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="num mt-1 text-[11px] text-slate-500">range over {result.trials} trials · staged {fmt(a.min)}–{fmt(a.max)} · baseline {fmt(b.min)}–{fmt(b.max)}</div>
          </div>
        );
      })}
    </div>
  );
}

export function ExposureChart({ result }: { result: ExperimentResult }) {
  const s = result.representative.staged.exposure_curve, b = result.representative.all_at_once.exposure_curve;
  const data = s.map((p, i) => ({ hour: p.hour, staged: p.exposure, base: b[i]?.exposure }));
  return (
    <Panel title="Cumulative simulated exposure" subtitle="Urgency-weighted machine-hours without the patch (trial 1). Staged trades exposure for safety.">
      <div className="h-64">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ left: -4, right: 10, top: 6 }}>
            <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
            <XAxis dataKey="hour" tickFormatter={(h) => `${Math.round(h / 24)}d`} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip {...chartTooltipStyle} labelFormatter={(h) => `hour ${h}`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line dataKey="staged" name="Staged" stroke={STAGED} dot={false} strokeWidth={2} />
            <Line dataKey="base" name="All-at-once" stroke={BASE} dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

export function SummaryTable({ result }: { result: ExperimentResult }) {
  const rows = [...METRICS, { key: "rolled_back", label: "Rolled back", lowerBetter: true, hint: "" }, { key: "undetected_degraded", label: "Undetected degraded", lowerBetter: true, hint: "" }] as typeof METRICS;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead><tr><th className="th">Metric</th><th className="th">Staged mean [min–max]</th><th className="th">All-at-once mean [min–max]</th></tr></thead>
        <tbody>{rows.map((m) => {
          const a = stat(result.summary.staged[m.key]), b = stat(result.summary.all_at_once[m.key]);
          return <tr key={m.key} className="border-t border-white/5"><td className="td">{m.label}</td>
            <td className="td num">{a.mean} <span className="text-slate-500">[{a.min}–{a.max}]</span></td>
            <td className="td num">{b.mean} <span className="text-slate-500">[{b.min}–{b.max}]</span></td></tr>;
        })}
          <tr className="border-t border-white/5"><td className="td">Trials that auto-halted</td><td className="td num">{result.summary.staged.halted_trials} / {result.trials}</td><td className="td num">{result.summary.all_at_once.halted_trials} / {result.trials}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

export default function Comparison({ result, name }: { result: ExperimentResult; name: string }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-warn/30 bg-warn/10 px-4 py-2.5 text-xs text-amber-200">
        <SyntheticTag /> <span><strong>{name}</strong> · experiment #{result.id} · seed {result.seed} · {result.trials} trials. These are <em>simulation results</em> on a synthetic fleet under a documented failure model – not real-world outcomes.</span>
      </div>
      <MetricCards result={result} />
      <ExposureChart result={result} />
      <Panel title="All metrics" subtitle="Mean and [min–max] across outcome seeds"><SummaryTable result={result} /></Panel>
    </div>
  );
}
