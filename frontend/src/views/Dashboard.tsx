import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { Bar as RBar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import FleetMap, { Legend } from "../components/FleetMap";
import type { ColorMode } from "../components/mapShared";
import MachineDetail from "../components/MachineDetail";
import { Badge, chartTooltipStyle, Empty, ErrorBox, Panel, Segmented, Skeleton, Stat, SyntheticTag, useAsync } from "../components/ui";
import { api } from "../lib/api";
import { ACTION_LABEL, BAND_COLOR, READINESS_COLOR, READINESS_LABEL, titleCase } from "../lib/format";

const OS_COLORS = ["#3de8ff", "#7aa7ff", "#a78bfa", "#64d6c4", "#fbbf24", "#fb923c", "#f472b6"];

export default function Dashboard({ go }: { go: (r: string) => void }) {
  const dash = useAsync(() => api.dashboard(), []);
  const fleet = useAsync(() => api.fleet({ limit: 500 }), []);
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [mode, setMode] = useState<ColorMode>("readiness");
  const items = fleet.data?.items ?? [];
  const hovered = useMemo(() => items.find((i) => i.id === hover), [items, hover]);

  if (dash.error) return <ErrorBox error={dash.error} onRetry={dash.reload} />;
  const d = dash.data;

  return (
    <div className="space-y-5">
      <Panel pad={false} className="relative overflow-hidden">
        <div className="relative h-[430px] w-full" aria-label="Interactive 3D map of the synthetic fleet. Move the pointer to tilt; click a node to inspect it.">
          {fleet.loading && !items.length ? <Skeleton className="h-full w-full" /> : items.length ? (
            <FleetMap items={items} selectedId={sel} onSelect={setSel} onHover={setHover} colorMode={mode} />
          ) : <div className="p-6"><Empty title="No fleet data" hint="The inventory is empty. Re-seed it from the Fleet view." /></div>}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 bg-gradient-to-b from-ink-950/80 to-transparent p-5">
            <div>
              <div className="label text-cyan-glow">Fleet risk map</div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Patch with evidence, not hope.</h1>
              <p className="mt-1 max-w-md text-xs text-slate-400">Every node is a synthetic machine. Size = business criticality. Pointer tilts the scene; nodes near the cursor light up.</p>
            </div>
            <div className="pointer-events-auto flex items-center gap-2"><SyntheticTag /><Segmented value={mode} onChange={setMode} options={[{ value: "readiness", label: "Readiness" }, { value: "urgency", label: "Urgency" }]} /></div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-3 bg-gradient-to-t from-ink-950/85 to-transparent p-5">
            <Legend mode={mode} />
            {hovered && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-white/10 bg-ink-900/90 px-3 py-2 text-xs">
                <div className="font-medium text-slate-100">{hovered.hostname}</div>
                <div className="text-slate-400">{hovered.os_family} {hovered.os_version} · {hovered.exposure} · crit {hovered.criticality}</div>
                <div className="mt-1 flex gap-2"><Badge color={READINESS_COLOR[hovered.readiness]}>{READINESS_LABEL[hovered.readiness]}</Badge><Badge color={BAND_COLOR[hovered.band]}>{hovered.urgency.toFixed(0)}</Badge></div>
              </motion.div>
            )}
          </div>
        </div>
      </Panel>

      {sel && (
        <Panel title={`Inspecting ${sel}`} actions={<button className="btn" onClick={() => setSel(null)}>Close</button>}>
          <MachineDetail id={sel} />
        </Panel>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {d ? (
          <>
            <Stat label="Machines" value={d.totals.machines} hint={`seed ${d.meta.seed}`} tone="cyan" />
            <Stat label="Patches pending" value={d.totals.pending} hint={`${d.totals.compliant} compliant`} />
            <Stat label="Ready to deploy" value={d.readiness.filter((r) => r.name === "ready" || r.name === "ready_with_caution").reduce((a, b) => a + b.value, 0)} tone="good" />
            <Stat label="Blocked / no evidence" value={d.readiness.filter((r) => r.name === "blocked" || r.name === "insufficient_evidence").reduce((a, b) => a + b.value, 0)} tone="bad" hint="never treated as safe" />
            <Stat label="Telemetry gaps" value={d.totals.no_telemetry} tone={d.totals.no_telemetry ? "warn" : "good"} />
            <Stat label="Already degraded" value={d.totals.degraded} tone={d.totals.degraded ? "warn" : "good"} hint="latency/errors over limit" />
          </>
        ) : Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[88px]" />)}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="OS distribution" subtitle="Machines by family">
          {d ? (
            <div className="h-56">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={d.os_distribution} dataKey="value" nameKey="name" innerRadius={52} outerRadius={84} paddingAngle={2} stroke="none">
                    {d.os_distribution.map((_, i) => <Cell key={i} fill={OS_COLORS[i % OS_COLORS.length]} />)}
                  </Pie>
                  <Tooltip {...chartTooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <Skeleton className="h-56" />}
          {d && <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-300">{d.os_distribution.map((o, i) => <li key={o.name} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: OS_COLORS[i % OS_COLORS.length] }} />{o.name} <span className="num ml-auto text-slate-400">{o.value}</span></li>)}</ul>}
        </Panel>

        <Panel title="Deployment readiness" subtitle="Rule-based gate, separate from urgency">
          {d ? (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={d.readiness.map((r) => ({ ...r, label: READINESS_LABEL[r.name] }))} layout="vertical" margin={{ left: 20, right: 12 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="label" width={130} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip {...chartTooltipStyle} />
                  <RBar dataKey="value" radius={[0, 6, 6, 0]} barSize={16}>{d.readiness.map((r) => <Cell key={r.name} fill={READINESS_COLOR[r.name]} />)}</RBar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <Skeleton className="h-64" />}
        </Panel>

        <Panel title="Urgency bands" subtitle="Pending machines only">
          {d ? (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={d.risk_bands.map((r) => ({ ...r, name: titleCase(r.name) }))} margin={{ top: 10, right: 8 }}>
                  <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip {...chartTooltipStyle} />
                  <RBar dataKey="value" radius={[6, 6, 0, 0]} barSize={34}>{d.risk_bands.map((r) => <Cell key={r.name} fill={BAND_COLOR[r.name]} />)}</RBar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <Skeleton className="h-64" />}
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Outstanding patches" subtitle="Synthetic patch catalogue">
          {!d ? <Skeleton className="h-40" /> : d.outstanding_patches.length === 0 ? <Empty title="Nothing outstanding" hint="Every machine is compliant." /> : (
            <table className="w-full text-left">
              <thead><tr><th className="th">Patch</th><th className="th">CVSS</th><th className="th text-right">Machines</th></tr></thead>
              <tbody>{d.outstanding_patches.map((p) => (
                <tr key={p.patch_id} className="border-t border-white/5">
                  <td className="td"><div className="num text-xs text-slate-200">{p.patch_id}</div><div className="text-[11px] text-slate-500">{p.title}</div></td>
                  <td className="td"><span className="num">{p.cvss.toFixed(1)}</span> {p.known_exploited && <Badge color="#fb7185">exploited</Badge>}</td>
                  <td className="td num text-right">{p.machines}</td>
                </tr>))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Priority queue" subtitle="Deployable machines, highest urgency first" actions={<button className="btn" onClick={() => go("simulator")}>Open simulator</button>}>
          {!d ? <Skeleton className="h-40" /> : d.priority_queue.length === 0 ? <Empty title="No deployable machines" hint="Everything pending is blocked or lacks evidence." /> : (
            <ul className="divide-y divide-white/5">
              {d.priority_queue.map((q) => (
                <li key={q.machine_id}><button onClick={() => setSel(q.machine_id)} className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-white/[0.03]">
                  <span><span className="num text-xs text-slate-200">{q.hostname}</span><span className="block text-[11px] text-slate-500">{ACTION_LABEL[q.action] ?? q.action}</span></span>
                  <Badge color={BAND_COLOR[q.band]}>{q.urgency.toFixed(1)}</Badge>
                </button></li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Urgent but stuck" subtitle="High urgency, not deployable – escalate and mitigate">
          {!d ? <Skeleton className="h-40" /> : d.stuck_urgent.length === 0 ? <Empty title="No stuck machines" /> : (
            <ul className="divide-y divide-white/5">
              {d.stuck_urgent.map((q) => (
                <li key={q.machine_id}><button onClick={() => setSel(q.machine_id)} className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-white/[0.03]">
                  <span><span className="num text-xs text-slate-200">{q.hostname}</span><span className="block text-[11px] text-slate-500">{q.blockers.join(", ")}</span></span>
                  <span className="flex gap-1.5"><Badge color={READINESS_COLOR[q.readiness]}>{READINESS_LABEL[q.readiness]}</Badge><Badge color={BAND_COLOR[q.band]}>{q.urgency.toFixed(0)}</Badge></span>
                </button></li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent activity" subtitle="From the persisted audit log" actions={<button className="btn" onClick={() => go("audit")}>Audit center</button>}>
          {!d ? <Skeleton className="h-40" /> : d.recent_activity.length === 0 ? <Empty title="No activity yet" hint="Run a rollout or experiment to create audit events." /> : (
            <ul className="space-y-2">
              {d.recent_activity.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 text-xs">
                  <span><span className="num text-cyan-soft">{e.action}</span> <span className="text-slate-400">{e.subject}</span></span>
                  <span className="num shrink-0 text-slate-500">{new Date(e.ts).toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
