import { useEffect, useState } from "react";
import { Badge, Empty, ErrorBox, Field, NumberInput, Panel, Select, Skeleton, cx, useAsync } from "../components/ui";
import { api, type AuditQuery } from "../lib/api";

const PAGE = 50;

export default function Audit() {
  const [category, setCategory] = useState("");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [rollout, setRollout] = useState<number | "">("");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { const t = setTimeout(() => { setQ(text); setOffset(0); }, 250); return () => clearTimeout(t); }, [text]);

  const query: AuditQuery = { category, q, rollout_id: rollout, limit: PAGE, offset };
  const res = useAsync(() => api.audit(query), [category, q, rollout, offset]);
  const d = res.data;

  return (
    <div className="space-y-5">
      <Panel title="Audit center" subtitle="Timestamped, persisted record of decisions, rollout events, triggered rules and experiment results"
        actions={<>
          <a className="btn" href={api.auditExportUrl("csv", query)} download>Export CSV</a>
          <a className="btn" href={api.auditExportUrl("json", query)} download>Export JSON</a>
        </>}>
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Category"><Select ariaLabel="Category" value={category} onChange={(v) => { setCategory(v); setOffset(0); }} options={[{ value: "", label: "All categories" }, ...(d?.categories ?? []).map((c) => ({ value: c, label: c }))]} /></Field>
          <div className="md:col-span-2"><Field label="Search"><input className="input" placeholder="action, subject, rule, detail…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search audit log" /></Field></div>
          <Field label="Rollout #"><NumberInput value={rollout === "" ? NaN : rollout} min={1} ariaLabel="Rollout id" onChange={(v) => { setRollout(Number.isFinite(v) ? v : ""); setOffset(0); }} /></Field>
        </div>
      </Panel>

      {res.error && <ErrorBox error={res.error} onRetry={res.reload} />}
      <Panel pad={false}>
        {res.loading && !d ? <div className="space-y-2 p-5">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div> : !d?.items.length ? (
          <div className="p-5"><Empty title="No audit events match" hint="Run a rollout or experiment, or widen the filters." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead><tr className="border-b border-white/5"><th className="th">Time (UTC)</th><th className="th">Category</th><th className="th">Action</th><th className="th">Subject</th><th className="th">Rule</th><th className="th">Sim t</th><th className="th">Ref</th></tr></thead>
              <tbody>
                {d.items.map((e) => (
                  <>
                    <tr key={e.id} className={cx("cursor-pointer border-t border-white/5 hover:bg-white/[0.035]", open === e.id && "bg-white/[0.04]")} tabIndex={0} aria-expanded={open === e.id}
                      onClick={() => setOpen(open === e.id ? null : e.id)} onKeyDown={(k) => (k.key === "Enter" || k.key === " ") && (k.preventDefault(), setOpen(open === e.id ? null : e.id))}>
                      <td className="td num text-xs text-slate-400">{e.ts.replace("T", " ").slice(0, 23)}</td>
                      <td className="td"><Badge color={{ rollout: "#3de8ff", experiment: "#a78bfa", config: "#fbbf24", system: "#64748b" }[e.category] ?? "#94a3b8"}>{e.category}</Badge></td>
                      <td className="td num text-xs text-slate-100">{e.action}</td>
                      <td className="td text-xs text-slate-300">{e.subject}</td>
                      <td className="td num text-xs text-cyan-soft">{e.rule}</td>
                      <td className="td num text-xs text-slate-500">{e.sim_minute ?? ""}</td>
                      <td className="td num text-xs text-slate-500">{e.rollout_id ? `R${e.rollout_id}` : e.experiment_id ? `E${e.experiment_id}` : ""}</td>
                    </tr>
                    {open === e.id && <tr key={`${e.id}d`}><td colSpan={7} className="bg-ink-950/60 p-4"><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-slate-300">{JSON.stringify(e.detail, null, 2)}</pre></td></tr>}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d && d.total > 0 && (
          <div className="flex items-center justify-between border-t border-white/5 px-5 py-3 text-xs text-slate-400">
            <span className="num">{offset + 1}–{Math.min(offset + PAGE, d.total)} of {d.total}</span>
            <span className="flex gap-2"><button className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button><button className="btn" disabled={offset + PAGE >= d.total} onClick={() => setOffset(offset + PAGE)}>Next</button></span>
          </div>
        )}
      </Panel>
    </div>
  );
}
