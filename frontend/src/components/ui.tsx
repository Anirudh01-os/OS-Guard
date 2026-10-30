import { motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ApiError } from "../lib/api";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/* ------------------------------------------------------------------ data loading */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    fn()
      .then((d) => { if (id === seq.current) { setData(d); setError(null); } })
      .catch((e: unknown) => { if (id === seq.current) setError(e instanceof ApiError ? e.message : String(e)); })
      .finally(() => { if (id === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, error, loading, reload: run, setData };
}

/* ------------------------------------------------------------------ layout atoms */
export function Panel({ title, subtitle, actions, children, className, pad = true }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={cx("panel", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
          <div>
            {title && <h2 className="text-[15px] font-semibold tracking-tight text-slate-100">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx(pad ? "p-5" : "", title && pad ? "pt-4" : "")}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "good" | "warn" | "bad" | "cyan" }) {
  const color = { default: "text-slate-100", good: "text-ok", warn: "text-warn", bad: "text-bad", cyan: "text-cyan-glow" }[tone];
  return (
    <div className="panel px-4 py-3.5">
      <div className="label">{label}</div>
      <div className={cx("num mt-1 text-2xl font-semibold", color)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export function Badge({ children, color = "#94a3b8", title }: { children: ReactNode; color?: string; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ color, borderColor: `${color}55`, background: `${color}14` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton rounded-lg", className)} aria-hidden="true" />;
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 px-6 py-10 text-center">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#3de8ff" strokeWidth="1.4" opacity=".7" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></svg>
      <div className="text-sm font-medium text-slate-200">{title}</div>
      {hint && <div className="max-w-md text-xs text-slate-400">{hint}</div>}
      {action}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-rose-200">
      <span>{error}</span>
      {onRetry && <button className="btn" onClick={onRetry}>Retry</button>}
    </div>
  );
}

/* ------------------------------------------------------------------ controls */
export function MagneticButton({ variant = "default", className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "danger" }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLButtonElement>(null);
  const x = useMotionValue(0), y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 16 }), sy = useSpring(y, { stiffness: 220, damping: 16 });
  const move = (e: React.PointerEvent) => {
    if (reduce || !ref.current || rest.disabled) return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * 0.22);
    y.set((e.clientY - (r.top + r.height / 2)) * 0.28);
  };
  const leave = () => { x.set(0); y.set(0); };
  return (
    <motion.button ref={ref} style={{ x: sx, y: sy }} onPointerMove={move} onPointerLeave={leave} whileTap={reduce ? undefined : { scale: 0.97 }}
      className={cx("btn", variant === "primary" && "btn-primary", variant === "danger" && "btn-danger", className)} {...(rest as object)}>
      {children}
    </motion.button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

export function Select({ value, onChange, options, ariaLabel }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; ariaLabel?: string }) {
  return (
    <select aria-label={ariaLabel} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value} className="bg-ink-900">{o.label}</option>)}
    </select>
  );
}

export function NumberInput({ value, onChange, min, max, step = 1, ariaLabel }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; ariaLabel?: string }) {
  return (
    <input aria-label={ariaLabel} type="number" className="input num" value={Number.isFinite(value) ? value : ""} min={min} max={max} step={step}
      onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))} />
  );
}

export function Slider({ value, onChange, min, max, step, format }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; format?: (v: number) => string }) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" className="h-1.5 w-full cursor-pointer" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="num w-14 text-right text-sm text-slate-200">{format ? format(value) : value}</span>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm text-slate-200 hover:border-cyan-glow/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-glow">
      <span>{label}</span>
      <span className={cx("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-cyan-glow/70" : "bg-ink-600")}>
        <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div role="tablist" className="inline-flex rounded-lg border border-white/10 bg-ink-900/60 p-0.5">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cx("rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-glow",
            value === o.value ? "bg-cyan-glow/15 text-cyan-soft" : "text-slate-400 hover:text-slate-200")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Bar({ value, max = 100, color = "#3de8ff", label }: { value: number; max?: number; color?: string; label?: string }) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

export const SyntheticTag = () => (
  <span className="rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warn" title="Computed on a synthetic fleet; not a real-world measurement.">
    Synthetic
  </span>
);

export const chartTooltipStyle = {
  contentStyle: { background: "rgba(11,14,19,.95)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, fontSize: 12, color: "#e2e8f0" },
  labelStyle: { color: "#94a3b8" },
  itemStyle: { color: "#e2e8f0" },
  cursor: { fill: "rgba(61,232,255,.06)" },
};
