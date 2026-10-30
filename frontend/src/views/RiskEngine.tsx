import { useEffect, useState } from "react";
import MachineDetail from "../components/MachineDetail";
import { ErrorBox, Field, MagneticButton, Panel, Select, Skeleton, Slider, Toggle, useAsync } from "../components/ui";
import { api } from "../lib/api";
import type { ScoringConfig } from "../lib/types";
import { validateScoring } from "../lib/validation";

const WEIGHTS: { key: keyof ScoringConfig; label: string; hint: string }[] = [
  { key: "w_severity", label: "Security severity", hint: "CVSS-style score (+ known-exploited bonus)" },
  { key: "w_exposure", label: "Exposure", hint: "internet / internal / isolated" },
  { key: "w_criticality", label: "Operational criticality", hint: "business criticality 1–5" },
  { key: "w_age", label: "Patch age", hint: "days the fix has been available" },
];

export default function RiskEngine() {
  const cfgReq = useAsync(() => api.scoring(), []);
  const fleet = useAsync(() => api.fleet({ limit: 500, sort: "urgency" }), []);
  const [cfg, setCfg] = useState<ScoringConfig | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [machine, setMachine] = useState("vm-001");
  const [rev, setRev] = useState(0);
  useEffect(() => { if (cfgReq.data) setCfg(cfgReq.data); }, [cfgReq.data]);

  if (cfgReq.error) return <ErrorBox error={cfgReq.error} onRetry={cfgReq.reload} />;
  if (!cfg) return <Skeleton className="h-96" />;
  const errs = validateScoring(cfg);
  const total = cfg.w_severity + cfg.w_exposure + cfg.w_criticality + cfg.w_age;
  const upd = (patch: Partial<ScoringConfig>) => { setCfg({ ...cfg, ...patch }); setMsg(null); };

  const save = async () => {
    setSaving(true);
    try { const saved = await api.saveScoring(cfg); setCfg(saved); setRev((r) => r + 1); fleet.reload(); setMsg({ ok: true, text: "Saved. All assessments were recomputed; the change is in the audit log." }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setSaving(false); }
  };
  const reset = async () => {
    try { setCfg(await api.resetScoring()); setRev((r) => r + 1); fleet.reload(); setMsg({ ok: true, text: "Defaults restored." }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-5">
      <div className="space-y-5 xl:col-span-2">
        <Panel title="Urgency weights" subtitle="Weights are normalised to sum to 100%; urgency = Σ weightᵢ · factorᵢ × 100">
          <div className="space-y-4">
            {WEIGHTS.map((w) => (
              <Field key={w.key} label={`${w.label} · ${total ? (((cfg[w.key] as number) / total) * 100).toFixed(0) : 0}%`} hint={w.hint}>
                <Slider value={cfg[w.key] as number} onChange={(v) => upd({ [w.key]: v } as Partial<ScoringConfig>)} min={0} max={1} step={0.05} format={(v) => v.toFixed(2)} />
              </Field>
            ))}
            <Field label="Known-exploited bonus" hint="Added to the severity factor (capped at 1.0)"><Slider value={cfg.exploited_bonus} onChange={(v) => upd({ exploited_bonus: v })} min={0} max={0.5} step={0.01} format={(v) => v.toFixed(2)} /></Field>
            <Field label="Patch-age saturation (days)" hint="Age factor reaches 1.0 at this many days"><Slider value={cfg.age_saturation_days} onChange={(v) => upd({ age_saturation_days: v })} min={7} max={180} step={1} /></Field>
          </div>
        </Panel>

        <Panel title="Bands & readiness gates" subtitle="Failed or missing mandatory evidence always blocks, regardless of these settings">
          <div className="space-y-4">
            <Field label="Critical band ≥"><Slider value={cfg.band_critical} onChange={(v) => upd({ band_critical: v })} min={0} max={100} step={1} /></Field>
            <Field label="High band ≥"><Slider value={cfg.band_high} onChange={(v) => upd({ band_high: v })} min={0} max={100} step={1} /></Field>
            <Field label="Medium band ≥"><Slider value={cfg.band_medium} onChange={(v) => upd({ band_medium: v })} min={0} max={100} step={1} /></Field>
            <Field label="Max pre-update latency ratio" hint="Machines already slower than this × baseline are blocked"><Slider value={cfg.health_latency_ratio_max} onChange={(v) => upd({ health_latency_ratio_max: v })} min={1} max={4} step={0.1} format={(v) => `×${v.toFixed(1)}`} /></Field>
            <Field label="Max pre-update error rate"><Slider value={cfg.health_error_rate_max} onChange={(v) => upd({ health_error_rate_max: v })} min={0} max={0.2} step={0.005} format={(v) => `${(v * 100).toFixed(1)}%`} /></Field>
            <Field label="Caution when uncertainty ≥" hint="Optional-evidence gaps mark a machine ‘ready with caution’"><Slider value={cfg.caution_uncertainty} onChange={(v) => upd({ caution_uncertainty: v })} min={0} max={1} step={0.01} format={(v) => `${(v * 100).toFixed(0)}%`} /></Field>
            <Toggle checked={cfg.require_telemetry} onChange={(v) => upd({ require_telemetry: v })} label="Require health telemetry before deploying" />
          </div>
          {errs.length > 0 && <ul role="alert" className="mt-4 space-y-1 text-xs text-rose-300">{errs.map((e) => <li key={e}>• {e}</li>)}</ul>}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <MagneticButton variant="primary" onClick={save} disabled={saving || errs.length > 0}>{saving ? "Saving…" : "Save & recompute"}</MagneticButton>
            <MagneticButton onClick={reset}>Reset to defaults</MagneticButton>
            {msg && <span role="status" className={msg.ok ? "text-xs text-ok" : "text-xs text-rose-300"}>{msg.text}</span>}
          </div>
        </Panel>
      </div>

      <div className="space-y-5 xl:col-span-3">
        <Panel title="How a recommendation is made" subtitle="Three separate quantities – never blended into one opaque score">
          <div className="grid gap-3 text-xs text-slate-300 md:grid-cols-3">
            <div className="rounded-lg bg-white/[0.03] p-3"><div className="label text-cyan-soft">Urgency</div><p className="mt-1">Severity, exposure, criticality and patch age, weighted as configured. Answers: <em>how much do we want this applied?</em></p></div>
            <div className="rounded-lg bg-white/[0.03] p-3"><div className="label text-bad">Compatibility risk</div><p className="mt-1">Share of check weight with a <strong>failed</strong> result. Negative evidence.</p></div>
            <div className="rounded-lg bg-white/[0.03] p-3"><div className="label text-warn">Uncertainty</div><p className="mt-1">Share of check weight (and telemetry) that is <strong>unknown</strong>. Missing evidence, never counted as a pass.</p></div>
          </div>
          <p className="mt-3 text-xs text-slate-400">Readiness precedence: blocked (negative evidence) &gt; insufficient evidence (missing evidence) &gt; needs approval &gt; ready with caution &gt; ready. Rules: B1 mandatory check failed · B2 mandatory evidence missing · B3 no telemetry · B4 vendor hold · B5 pre-update health degraded · B6 manual approval.</p>
        </Panel>

        <Panel title="Explain a machine" subtitle="Pick any machine to see the exact rules behind its recommendation"
          actions={<div className="w-56"><Select ariaLabel="Machine" value={machine} onChange={setMachine}
            options={(fleet.data?.items ?? []).slice().sort((a, b) => a.id.localeCompare(b.id)).map((m) => ({ value: m.id, label: `${m.id} · ${m.os_family}` }))} /></div>}>
          <MachineDetail key={`${machine}-${rev}`} id={machine} />
        </Panel>
      </div>
    </div>
  );
}
