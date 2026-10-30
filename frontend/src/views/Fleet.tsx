import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import FleetMap, { Legend } from "../components/FleetMap";
import MachineDetail from "../components/MachineDetail";
import { Badge, Bar, Empty, ErrorBox, Field, MagneticButton, NumberInput, Panel, Segmented, Select, Skeleton, SyntheticTag, useAsync, cx } from "../components/ui";
import { api, type FleetQuery } from "../lib/api";
import { BAND_COLOR, READINESS_COLOR, READINESS_LABEL, pct, urgencyColor } from "../lib/format";

const PAGE = 40;

export default function Fleet() {
  const [q, setQ] = useState<FleetQuery>({ sort: "urgency", order: "desc" });
  const [view, setView] = useState<"table" | "map">("table");
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [seed, setSeed] = useState(2026);
  const [note, setNote] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const facets = useAsync(async () => (await fetch("/api/fleet/facets")).json() as Promise<{ os_family: string[]; exposure: string[]; readiness: string[] }>, []);
  const list = useAsync(() => api.fleet(q), [JSON.stringify(q)]);
  const all = useAsync(() => api.fleet({ limit: 500 }), [note]);
  const set = (patch: Partial<FleetQuery>) => { setQ((p) => ({ ...p, ...patch })); setShown(PAGE); };
  const items = list.data?.items ?? [];
  const dim = useMemo(() => {
    if (!all.data || !list.data) return null;
    const keep = new Set(list.data.items.map((i) => i.id));
    return new Set(all.data.items.filter((i) => !keep.has(i.id)).map((i) => i.id));
  }, [all.data, list.data]);

  const reseed = async () => {
    setActionErr(null);
    try {
      await api.reseed(seed, 120);
      setNote(`Fleet regenerated deterministically from seed ${seed} and logged to the audit center.`);
      list.reload();
    } catch (e) { setActionErr(e instanceof Error ? e.message : String(e)); }
  };

  const opt = (xs: string[] | undefined, all: string) => [{ value: "", label: all }, ...(xs ?? []).map((x) => ({ value: x, label: x }))];

  return (
    <div className="space-y-5">
      <Panel title="Fleet inventory" subtitle={<span className="inline-flex items-center gap-2"><SyntheticTag /> Deterministically generated virtual machines – none are real.</span>}
        actions={<Segmented value={view} onChange={setView} options={[{ value: "table", label: "Table" }, { value: "map", label: "3D map" }]} />}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2"><Field label="Search"><input className="input" placeholder="hostname, id, role, OS…" value={q.search ?? ""} onChange={(e) => set({ search: e.target.value })} aria-label="Search machines" /></Field></div>
          <Field label="OS family"><Select ariaLabel="OS family" value={q.os_family ?? ""} onChange={(v) => set({ os_family: v })} options={opt(facets.data?.os_family, "All families")} /></Field>
          <Field label="Exposure"><Select ariaLabel="Exposure" value={q.exposure ?? ""} onChange={(v) => set({ exposure: v })} options={opt(facets.data?.exposure, "Any exposure")} /></Field>
          <Field label="Readiness"><Select ariaLabel="Readiness" value={q.readiness ?? ""} onChange={(v) => set({ readiness: v })}
            options={[{ value: "", label: "Any readiness" }, ...(facets.data?.readiness ?? []).map((r) => ({ value: r, label: READINESS_LABEL[r as keyof typeof READINESS_LABEL] ?? r }))]} /></Field>
          <Field label="Criticality"><Select ariaLabel="Criticality" value={String(q.criticality ?? "")} onChange={(v) => set({ criticality: v ? Number(v) : "" })}
            options={[{ value: "", label: "Any" }, ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} / 5` }))]} /></Field>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="w-44"><Field label="Sort by"><Select ariaLabel="Sort by" value={q.sort ?? "urgency"} onChange={(v) => set({ sort: v })}
            options={[["urgency", "Urgency"], ["criticality", "Criticality"], ["uncertainty", "Uncertainty"], ["risk", "Compat. risk"], ["latency", "Latency ratio"], ["hostname", "Hostname"]].map(([value, label]) => ({ value, label }))} /></Field></div>
          <MagneticButton onClick={() => set({ order: q.order === "desc" ? "asc" : "desc" })} aria-label="Toggle sort order">{q.order === "desc" ? "↓ Descending" : "↑ Ascending"}</MagneticButton>
          <MagneticButton onClick={() => { setQ({ sort: "urgency", order: "desc" }); setShown(PAGE); }}>Clear filters</MagneticButton>
          <span className="num ml-auto text-xs text-slate-400">{list.data ? `${list.data.total} machines match` : ""}</span>
        </div>
      </Panel>

      {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}

      {view === "map" ? (
        <Panel pad={false}>
          <div className="relative h-[520px]">
            {all.data && <FleetMap items={all.data.items} dimIds={dim} selectedId={open} onSelect={setOpen} />}
            <div className="pointer-events-none absolute bottom-3 left-4"><Legend mode="readiness" /></div>
            <div className="pointer-events-none absolute right-4 top-3 text-[11px] text-slate-400">Filters dim non-matching nodes · click a node to inspect</div>
          </div>
          {open && <div className="border-t border-white/5 p-5"><MachineDetail id={open} /></div>}
        </Panel>
      ) : (
        <Panel pad={false}>
          {list.loading && !list.data ? <div className="space-y-2 p-5">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div> : items.length === 0 ? (
            <div className="p-5"><Empty title="No machines match these filters" hint="Loosen the search or clear the filters." action={<button className="btn" onClick={() => setQ({ sort: "urgency", order: "desc" })}>Clear filters</button>} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left">
                <thead><tr className="border-b border-white/5">
                  <th className="th">Host</th><th className="th">OS</th><th className="th">Exposure</th><th className="th">Crit.</th><th className="th">Readiness</th>
                  <th className="th w-40">Urgency</th><th className="th">Risk</th><th className="th">Uncert.</th><th className="th">Latency</th>
                </tr></thead>
                <tbody>
                  {items.slice(0, shown).map((m) => (
                    <FragmentRow key={m.id} open={open === m.id} onToggle={() => setOpen(open === m.id ? null : m.id)} m={m} />
                  ))}
                </tbody>
              </table>
              {shown < items.length && <div className="p-4 text-center"><button className="btn" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, items.length - shown)} more ({items.length - shown} remaining)</button></div>}
            </div>
          )}
        </Panel>
      )}

      <Panel title="Regenerate synthetic fleet" subtitle="Same seed → identical fleet. Writes a FLEET_RESEEDED audit event.">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40"><Field label="Seed"><NumberInput value={seed} onChange={setSeed} min={0} ariaLabel="Seed" /></Field></div>
          <MagneticButton variant="primary" onClick={reseed} disabled={!Number.isInteger(seed) || seed < 0}>Regenerate (120 machines)</MagneticButton>
          {note && <span role="status" className="text-xs text-ok">{note}</span>}
        </div>
        {actionErr && <div className="mt-3"><ErrorBox error={actionErr} /></div>}
      </Panel>
    </div>
  );
}

function FragmentRow({ m, open, onToggle }: { m: import("../lib/types").FleetItem; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className={cx("cursor-pointer border-t border-white/5 transition-colors hover:bg-white/[0.035]", open && "bg-white/[0.04]")} onClick={onToggle}
        tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onToggle())} aria-expanded={open}>
        <td className="td"><div className="num text-xs text-slate-100">{m.id}</div><div className="max-w-[200px] truncate text-[11px] text-slate-500">{m.role}</div></td>
        <td className="td text-xs">{m.os_family}<div className="text-[11px] text-slate-500">{m.os_version}</div></td>
        <td className="td text-xs capitalize">{m.exposure}</td>
        <td className="td"><span className="flex gap-0.5" aria-label={`criticality ${m.criticality} of 5`}>{[1, 2, 3, 4, 5].map((n) => <span key={n} className={cx("h-2 w-1.5 rounded-sm", n <= m.criticality ? "bg-cyan-glow" : "bg-white/10")} />)}</span></td>
        <td className="td"><Badge color={READINESS_COLOR[m.readiness]}>{READINESS_LABEL[m.readiness]}</Badge></td>
        <td className="td"><div className="flex items-center gap-2"><span className="num w-9 text-xs" style={{ color: BAND_COLOR[m.band] }}>{m.urgency.toFixed(1)}</span><Bar value={m.urgency} color={urgencyColor(m.urgency)} label="urgency" /></div></td>
        <td className="td num text-xs">{pct(m.compatibility_risk)}</td>
        <td className="td num text-xs">{pct(m.uncertainty)}</td>
        <td className="td num text-xs">×{(m.health.latency_ms / m.health.baseline_latency_ms).toFixed(2)}</td>
      </tr>
      <AnimatePresence initial={false}>
        {open && (
          <tr><td colSpan={9} className="p-0">
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
              <div className="border-t border-cyan-glow/20 bg-ink-950/50 p-5"><MachineDetail id={m.id} /></div>
            </motion.div>
          </td></tr>
        )}
      </AnimatePresence>
    </>
  );
}
