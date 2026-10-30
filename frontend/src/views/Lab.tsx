import { motion } from "framer-motion";
import { useState } from "react";
import Comparison from "../components/Comparison";
import { Empty, ErrorBox, Field, MagneticButton, NumberInput, Panel, Skeleton, SyntheticTag, useAsync } from "../components/ui";
import { api } from "../lib/api";
import type { ExperimentResult } from "../lib/types";

export default function Lab({ go }: { go: (r: string) => void }) {
  const scenarios = useAsync(() => api.scenarios(), []);
  const history = useAsync(() => api.experiments(), []);
  const [seed, setSeed] = useState(2026);
  const [trials, setTrials] = useState(10);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ExperimentResult | null>(null);
  const valid = Number.isInteger(trials) && trials >= 1 && trials <= 200 && Number.isInteger(seed) && seed >= 0;

  const run = async (ids: string[]) => {
    setErr(null);
    try {
      for (const id of ids) {
        setBusy(id);
        setResult(await api.runExperiment(id, seed, trials));
      }
      history.reload();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  const open = async (id: number) => {
    setErr(null);
    try { setResult(await api.experiment(id)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  const nameOf = (id: string) => scenarios.data?.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="space-y-5">
      <Panel title="Experiment lab" subtitle={<span className="inline-flex items-center gap-2"><SyntheticTag />Each run replays one scenario for both strategies over several outcome seeds. Same inputs → identical output.</span>}
        actions={<div className="flex flex-wrap items-end gap-3">
          <div className="w-28"><Field label="Seed"><NumberInput value={seed} onChange={setSeed} min={0} ariaLabel="Experiment seed" /></Field></div>
          <div className="w-28"><Field label="Trials"><NumberInput value={trials} onChange={setTrials} min={1} max={200} ariaLabel="Trials" /></Field></div>
          <MagneticButton variant="primary" disabled={!valid || !!busy || !scenarios.data} onClick={() => run(scenarios.data!.map((s) => s.id))}>{busy ? "Running…" : "Run all scenarios"}</MagneticButton>
        </div>}>
        {!valid && <p role="alert" className="mb-3 text-xs text-rose-300">Seed must be a non-negative integer and trials must be 1–200.</p>}
        {scenarios.error && <ErrorBox error={scenarios.error} onRetry={scenarios.reload} />}
        {scenarios.loading && !scenarios.data ? <div className="grid gap-3 md:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-36" />)}</div> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {scenarios.data?.map((s, i) => (
              <motion.div key={s.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="panel flex flex-col p-4">
                <div className="text-sm font-semibold text-slate-100">{s.name}</div>
                <p className="mt-1 text-xs text-slate-400">{s.description}</p>
                <p className="mt-2 text-[11px] text-slate-500"><span className="text-cyan-soft">Expectation:</span> {s.expectation}</p>
                <div className="mt-auto pt-3"><MagneticButton disabled={!valid || !!busy} onClick={() => run([s.id])} className="w-full">{busy === s.id ? "Running…" : "Run scenario"}</MagneticButton></div>
              </motion.div>
            ))}
          </div>
        )}
        {err && <div className="mt-3"><ErrorBox error={err} /></div>}
      </Panel>

      {result ? <Comparison result={result} name={nameOf(result.scenario_id)} /> : (
        <Panel><Empty title="No experiment selected" hint="Run a scenario above, or open a stored experiment below." /></Panel>
      )}

      <Panel title="Stored experiments" subtitle="Persisted in SQLite · open one to re-inspect it" actions={<button className="btn" onClick={() => go("analytics")}>Open analytics</button>}>
        {!history.data?.length ? <Empty title="Nothing stored yet" hint="Results appear here after the first run." /> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-xs">
            <thead><tr><th className="th">#</th><th className="th">Scenario</th><th className="th">Seed</th><th className="th">Trials</th><th className="th">Blast radius (staged / base)</th><th className="th">When</th><th className="th" /></tr></thead>
            <tbody>{history.data.map((e) => (
              <tr key={e.id} className="border-t border-white/5">
                <td className="td num">{e.id}</td><td className="td">{nameOf(e.scenario_id)}</td><td className="td num">{e.seed}</td><td className="td num">{e.trials}</td>
                <td className="td num">{(e.summary.staged.blast_radius as { mean: number }).mean} / {(e.summary.all_at_once.blast_radius as { mean: number }).mean}</td>
                <td className="td num text-slate-500">{new Date(e.created_at).toLocaleString()}</td>
                <td className="td"><button className="btn" onClick={() => open(e.id)}>Open</button></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Panel>
    </div>
  );
}
