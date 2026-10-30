import { useReducedMotion } from "framer-motion";
import { Component, lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { READINESS_COLOR, READINESS_LABEL, urgencyColor } from "../lib/format";
import { flatten, layoutFleet } from "../lib/layout";
import type { Readiness } from "../lib/types";
import { Skeleton } from "./ui";
import { nodeColor, type ColorMode, type FleetMapProps } from "./mapShared";

const Fleet3D = lazy(() => import("./Fleet3D"));

export function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch {
    return false;
  }
}

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.warn("3D view failed, using 2D fallback:", err); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Accessible 2D radial map used when WebGL is unavailable (or the 3D scene throws). */
function Fallback2D({ items, selectedId, onSelect, onHover, dimIds, colorMode = "readiness" }: FleetMapProps) {
  const pts = useMemo(() => flatten(layoutFleet(items)), [items]);
  const by = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  return (
    <div className="relative h-full w-full">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="group" aria-label="Fleet map (2D fallback)">
        {pts.map((p) => {
          const it = by.get(p.id)!;
          const dim = dimIds?.has(p.id);
          return (
            <circle key={p.id} cx={p.x} cy={p.y} r={0.9 + it.criticality * 0.28} fill={nodeColor(it, colorMode)} opacity={dim ? 0.18 : 0.95}
              stroke={p.id === selectedId ? "#fff" : "none"} strokeWidth={0.5} tabIndex={0} role="button"
              aria-label={`${it.hostname}, ${READINESS_LABEL[it.readiness]}, urgency ${it.urgency.toFixed(0)}`}
              onClick={() => onSelect?.(p.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect?.(p.id)}
              onMouseEnter={() => onHover?.(p.id)} onMouseLeave={() => onHover?.(null)} style={{ cursor: "pointer" }} />
          );
        })}
      </svg>
      <div className="absolute left-3 top-3 rounded-md border border-warn/30 bg-warn/10 px-2 py-1 text-[11px] text-warn">WebGL unavailable – showing 2D map</div>
    </div>
  );
}

export function Legend({ mode }: { mode: ColorMode }) {
  const entries: [string, string][] = mode === "readiness"
    ? (Object.keys(READINESS_COLOR) as Readiness[]).map((k) => [READINESS_LABEL[k], READINESS_COLOR[k]])
    : [["Critical ≥70", urgencyColor(80)], ["High ≥55", urgencyColor(60)], ["Medium ≥35", urgencyColor(40)], ["Low", urgencyColor(10)]];
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-300">
      {entries.map(([l, c]) => (
        <li key={l} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{l}</li>
      ))}
    </ul>
  );
}

export default function FleetMap(props: FleetMapProps) {
  const reduce = useReducedMotion() ?? false;
  const [webgl] = useState(hasWebGL);
  const fb = <Fallback2D {...props} />;
  if (!webgl) return fb;
  return (
    <Boundary fallback={fb}>
      <Suspense fallback={<Skeleton className="h-full w-full" />}>
        <Fleet3D {...props} reduceMotion={reduce} />
      </Suspense>
    </Boundary>
  );
}
