import { ACTION_LABEL, BAND_COLOR, READINESS_COLOR, READINESS_LABEL, pct, titleCase } from "../lib/format";
import { api } from "../lib/api";
import { Badge, Bar, ErrorBox, Skeleton, useAsync } from "./ui";

const CHECK_COLOR = { pass: "#4ade80", fail: "#fb7185", unknown: "#fbbf24" } as const;
const MANDATORY = ["driver_compat", "app_compat", "backup_verified"];

/** Full, explainable view of one machine: every recommendation lists the rules that produced it. */
export default function MachineDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useAsync(() => api.machine(id), [id]);
  if (loading && !data) return <div className="space-y-2 p-1"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-24 w-full" /></div>;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const { machine: m, patch: p, assessment: a } = data;
  const h = m.health;
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-1">
        <div>
          <div className="label">Recommendation</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge color={READINESS_COLOR[a.readiness]}>{READINESS_LABEL[a.readiness]}</Badge>
            <Badge color={BAND_COLOR[a.urgency.band]}>Urgency {a.urgency.score.toFixed(1)} · {a.urgency.band}</Badge>
          </div>
          <div className="mt-2 text-sm font-medium text-cyan-soft">{ACTION_LABEL[a.action] ?? a.action}</div>
          <p className="mt-1 text-sm text-slate-300">{a.summary}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><div className="label">Compat. risk</div><div className="num text-slate-100">{pct(a.compatibility_risk)}</div><div className="text-[11px] text-slate-500">failed evidence</div></div>
          <div><div className="label">Uncertainty</div><div className="num text-slate-100">{pct(a.uncertainty)}</div><div className="text-[11px] text-slate-500">missing evidence</div></div>
        </div>
        <div>
          <div className="label mb-1">Health snapshot</div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-300">
            <dt>Latency</dt><dd className="num text-right">{h.latency_ms.toFixed(1)} ms (×{(h.latency_ms / h.baseline_latency_ms).toFixed(2)})</dd>
            <dt>Error rate</dt><dd className="num text-right">{pct(h.error_rate, 2)}</dd>
            <dt>CPU / Mem</dt><dd className="num text-right">{h.cpu_pct}% / {h.mem_pct}%</dd>
            <dt>Telemetry</dt><dd className="text-right">{m.telemetry_present ? "reporting" : <span className="text-warn">missing</span>}</dd>
            <dt>Restart needed</dt><dd className="text-right">{m.restart_required ? "yes" : "no (live patch)"}</dd>
            <dt>Last patched</dt><dd className="num text-right">{m.days_since_last_patch} d ago</dd>
          </dl>
        </div>
      </div>

      <div className="space-y-4 lg:col-span-1">
        <div>
          <div className="label mb-1">Urgency breakdown</div>
          <ul className="space-y-2">
            {a.urgency.components.map((c) => (
              <li key={c.name}>
                <div className="flex justify-between text-xs"><span className="text-slate-200">{titleCase(c.name)} <span className="text-slate-500">· w {(c.weight * 100).toFixed(0)}%</span></span><span className="num text-slate-100">{c.points.toFixed(1)} pts</span></div>
                <Bar value={c.raw} max={1} label={c.name} />
                <div className="mt-0.5 text-[11px] text-slate-500">{c.note}</div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="label mb-1">Compatibility evidence</div>
          <ul className="flex flex-wrap gap-1.5">
            {Object.entries(m.checks).map(([k, v]) => (
              <li key={k}><Badge color={CHECK_COLOR[v]} title={MANDATORY.includes(k) ? "mandatory check" : "optional check"}>{titleCase(k)}{MANDATORY.includes(k) ? " *" : ""}: {v}</Badge></li>
            ))}
          </ul>
          <div className="mt-1 text-[11px] text-slate-500">* mandatory – a fail or a missing result always blocks deployment.</div>
        </div>
      </div>

      <div className="space-y-4 lg:col-span-1">
        <div>
          <div className="label mb-1">Patch {p.id}</div>
          <p className="text-xs text-slate-300">{p.title}. CVSS <span className="num">{p.cvss.toFixed(1)}</span>{p.known_exploited && <span className="text-bad"> · known exploited (synthetic)</span>}, available {p.released_days_ago} d.</p>
          {p.hold_versions.includes(m.os_version) && <p className="mt-1 text-xs text-bad">{p.hold_reason}</p>}
        </div>
        <div>
          <div className="label mb-1">Why this recommendation</div>
          <ol className="space-y-1.5 text-xs text-slate-300">
            {a.reasons.map((r, i) => <li key={i} className="rounded-md bg-white/[0.03] px-2 py-1.5">{r}</li>)}
          </ol>
        </div>
      </div>
    </div>
  );
}
