import { motion } from "framer-motion";
import { Empty, ErrorBox, Panel, Skeleton, useAsync } from "../components/ui";
import { api } from "../lib/api";

export default function Research() {
  const s = useAsync(() => api.sources(), []);
  if (s.error) return <ErrorBox error={s.error} onRetry={s.reload} />;
  if (s.loading && !s.data) return <Skeleton className="h-96" />;
  if (!s.data) return <Empty title="No sources available" />;
  return (
    <div className="space-y-5">
      <Panel title="Research & sources" subtitle="How existing platforms approach update risk, and where a prototype like OSGuard sits next to them">
        <p className="max-w-3xl text-sm text-slate-300">OSGuard is an academic prototype. It <strong>does not replace</strong> Windows Update for Business, AWS Patch Manager, GKE upgrade controls, MDM tooling or ICS change management, and it does not guarantee that any update is safe. The summaries below paraphrase the linked official documentation; follow the links for authoritative, current detail.</p>
        <p className="mt-2 max-w-3xl text-xs text-slate-500">{s.data.verification}</p>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        {s.data.sources.map((src, i) => (
          <motion.div key={src.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Panel title={src.vendor} className="h-full">
              <p className="text-sm text-slate-300">{src.approach}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div><div className="label text-ok">Strengths</div><ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-slate-300">{src.strengths.map((x) => <li key={x}>{x}</li>)}</ul></div>
                <div><div className="label text-warn">Limitations</div><ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-slate-300">{src.limitations.map((x) => <li key={x}>{x}</li>)}</ul></div>
              </div>
              {src.note && <p className="mt-3 text-[11px] text-slate-500">{src.note}</p>}
              <ul className="mt-4 space-y-1.5">
                {src.links.map((l) => (
                  <li key={l.url}><a className="group inline-flex items-center gap-1.5 text-xs text-cyan-soft underline-offset-4 hover:underline" href={l.url} target="_blank" rel="noopener noreferrer">{l.title}<span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a>
                    <div className="num break-all text-[10px] text-slate-600">{l.url}</div></li>
                ))}
              </ul>
            </Panel>
          </motion.div>
        ))}
      </div>

      <Panel title="Where OSGuard differs – and where it doesn’t">
        <div className="overflow-x-auto"><table className="w-full text-left text-xs">
          <thead><tr><th className="th">Capability</th><th className="th">Commercial / vendor platforms</th><th className="th">OSGuard prototype</th></tr></thead>
          <tbody className="text-slate-300">
            {[
              ["Real patch deployment", "Yes (Patch Manager, Windows Update, GKE, …)", "No – simulation only; never touches a host"],
              ["Vendor compatibility holds", "Microsoft documents safeguard holds from vendor quality/compatibility data", "No – a synthetic ‘vendor hold’ is modelled for illustration"],
              ["Transparent, tunable scoring", "Not described on the cited pages", "Yes – weights and thresholds are editable and every result is explained"],
              ["Absence of evidence ≠ safe", "Not described on the cited pages", "Enforced: missing mandatory evidence or telemetry always blocks"],
              ["Scheduling / staged upgrades", "AWS maintenance windows; GKE maintenance windows, exclusions, surge and blue-green strategies", "Canary → batches with health thresholds, automatic halt and recorded decisions (simulated)"],
              ["Machine learning", "Not assessed", "None – deterministic rules only"],
            ].map((r) => <tr key={r[0]} className="border-t border-white/5"><td className="td font-medium text-slate-200">{r[0]}</td><td className="td">{r[1]}</td><td className="td">{r[2]}</td></tr>)}
          </tbody>
        </table></div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Evaluation methodology">
          <ol className="list-decimal space-y-1.5 pl-5 text-xs text-slate-300">
            <li>A deterministic synthetic fleet is generated from a seed (default 2026).</li>
            <li>A scenario rewrites a <em>copy</em> of the fleet and/or adds faults; the stored inventory never changes.</li>
            <li>Each machine’s hidden outcome is a hash of (seed, machine, patch) compared with a documented failure probability, so both strategies face identical truth.</li>
            <li>Both strategies run per trial seed; metrics are averaged and ranged across trials.</li>
            <li>Staged strategy is graded against its own rules (violations must be zero); the baseline ignores them by design.</li>
          </ol>
        </Panel>
        <Panel title="Third-party libraries">
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-300">
            {s.data.libraries.map((l) => <li key={l.name} className="flex justify-between"><span>{l.name}</span><span className="text-slate-500">{l.license}</span></li>)}
          </ul>
          <p className="mt-3 text-[11px] text-slate-500">All licences listed are permissive. See each package’s own licence file for full terms.</p>
        </Panel>
      </div>
    </div>
  );
}
