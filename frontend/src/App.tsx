import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { cx, useAsync } from "./components/ui";
import { api } from "./lib/api";
import Analytics from "./views/Analytics";
import Audit from "./views/Audit";
import Dashboard from "./views/Dashboard";
import Fleet from "./views/Fleet";
import Lab from "./views/Lab";
import Research from "./views/Research";
import RiskEngine from "./views/RiskEngine";
import Simulator from "./views/Simulator";

const icon = (d: string) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const ROUTES: { id: string; label: string; icon: ReactNode }[] = [
  { id: "dashboard", label: "Operations", icon: icon("M3 12h4l3-8 4 16 3-8h4") },
  { id: "fleet", label: "Fleet", icon: icon("M4 6h16M4 12h16M4 18h16") },
  { id: "risk", label: "Risk engine", icon: icon("M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z") },
  { id: "simulator", label: "Rollout simulator", icon: icon("M5 4l14 8-14 8z") },
  { id: "lab", label: "Experiment lab", icon: icon("M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3") },
  { id: "analytics", label: "Analytics", icon: icon("M4 20V10M10 20V4M16 20v-7M22 20H2") },
  { id: "audit", label: "Audit center", icon: icon("M8 4h8l4 4v12H4V4zM8 12h8M8 16h5") },
  { id: "research", label: "Research", icon: icon("M4 5a2 2 0 012-2h12v16H6a2 2 0 00-2 2zM8 7h6") },
];

function useRoute(): [string, (r: string) => void] {
  const read = () => { const h = window.location.hash.replace(/^#\/?/, ""); return ROUTES.some((r) => r.id === h) ? h : "dashboard"; };
  const [route, setRoute] = useState(read);
  useEffect(() => { const on = () => setRoute(read()); window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on); }, []);
  const go = useCallback((r: string) => { window.location.hash = `/${r}`; }, []);
  return [route, go];
}

export default function App() {
  const [route, go] = useRoute();
  const reduce = useReducedMotion();
  const health = useAsync(() => api.health(), []);
  const [nav, setNav] = useState(false);
  const current = ROUTES.find((r) => r.id === route)!;
  useEffect(() => { document.title = `${current.label} · OSGuard`; setNav(false); }, [current.label]);

  const view = {
    dashboard: <Dashboard go={go} />, fleet: <Fleet />, risk: <RiskEngine />, simulator: <Simulator />,
    lab: <Lab go={go} />, analytics: <Analytics go={go} />, audit: <Audit />, research: <Research />,
  }[route];

  return (
    <div className="flex min-h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-ink-800 focus:px-3 focus:py-2">Skip to content</a>
      <aside className={cx("fixed inset-y-0 left-0 z-40 w-60 shrink-0 border-r border-white/[0.06] bg-ink-950/90 backdrop-blur-xl transition-transform lg:static lg:translate-x-0", nav ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex h-16 items-center gap-2.5 px-5">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2 4 7v8c0 7.5 5 13 12 15 7-2 12-7.5 12-15V7z" fill="#0b0e13" stroke="#3de8ff" strokeWidth="2" /><circle cx="16" cy="15" r="4" fill="#3de8ff" /></svg>
          <div><div className="text-[15px] font-semibold tracking-tight text-white">OSGuard</div><div className="-mt-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-500">update orchestration</div></div>
        </div>
        <nav aria-label="Primary" className="space-y-0.5 px-3 pt-2">
          {ROUTES.map((r) => (
            <a key={r.id} href={`#/${r.id}`} aria-current={route === r.id ? "page" : undefined}
              className={cx("relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-glow", route === r.id ? "text-cyan-soft" : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100")}>
              {route === r.id && <motion.span layoutId="nav-pill" transition={{ type: "spring", stiffness: 380, damping: 32 }} className="absolute inset-0 rounded-lg border border-cyan-glow/25 bg-cyan-glow/10" />}
              <span className="relative">{r.icon}</span><span className="relative">{r.label}</span>
            </a>
          ))}
        </nav>
        <div className="absolute inset-x-0 bottom-0 space-y-2 p-4 text-[11px] text-slate-500">
          <div className="flex items-center gap-2"><span className={cx("h-2 w-2 rounded-full", health.error ? "bg-bad" : health.data ? "bg-ok" : "bg-warn")} />{health.error ? "API unreachable" : health.data ? `API online · ${health.data.machines} synthetic VMs` : "Connecting…"}</div>
          <div>Academic prototype. No real systems are modified.</div>
        </div>
      </aside>
      {nav && <button aria-label="Close menu" className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setNav(false)} />}

      <div className="min-w-0 flex-1">
        <div className="border-b border-warn/20 bg-warn/[0.07] px-4 py-1.5 text-center text-[11px] text-amber-200/90 sm:px-6">
          <strong>Synthetic data &amp; simulated outcomes.</strong> Nothing here is a real-world measurement, and OSGuard never installs patches or changes a host.
        </div>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-white/[0.06] bg-ink-900/70 px-4 backdrop-blur-xl sm:px-6">
          <button className="btn lg:hidden" aria-label="Open menu" aria-expanded={nav} onClick={() => setNav(true)}>☰</button>
          <h1 className="text-base font-semibold tracking-tight text-slate-100">{current.label}</h1>
        </header>
        <main id="main" className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6">
          {health.error && <div role="alert" className="mb-4 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-rose-200">{health.error} Start it with <code className="num">python run.py</code> in <code className="num">backend/</code>, or use <code className="num">start.ps1</code>.</div>}
          <AnimatePresence mode="wait">
            <motion.div key={route} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              {view}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
