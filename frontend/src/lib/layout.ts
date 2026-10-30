/** Deterministic 3D layout for the fleet map: one cluster per OS family, nodes on a Fibonacci shell. */
export interface LayoutNode { id: string; family: string; x: number; y: number; z: number; hub: boolean }
export interface Layout { nodes: LayoutNode[]; edges: [number, number][] }

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

function fib(i: number, n: number, r: number): [number, number, number] {
  const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
  const rad = Math.sqrt(Math.max(0, 1 - y * y));
  const th = GOLDEN * i;
  return [Math.cos(th) * rad * r, y * r, Math.sin(th) * rad * r];
}

export function layoutFleet(items: { id: string; os_family: string }[]): Layout {
  const families = [...new Set(items.map((i) => i.os_family))].sort();
  const centers = new Map<string, [number, number, number]>();
  families.forEach((f, i) => centers.set(f, fib(i, families.length, 4.6)));
  const byFamily = new Map<string, number[]>();
  const nodes: LayoutNode[] = [];
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const counts = new Map<string, number>();
  sorted.forEach((it) => counts.set(it.os_family, (counts.get(it.os_family) ?? 0) + 1));
  const seen = new Map<string, number>();
  sorted.forEach((it, idx) => {
    const k = seen.get(it.os_family) ?? 0;
    seen.set(it.os_family, k + 1);
    const [cx, cy, cz] = centers.get(it.os_family)!;
    const n = counts.get(it.os_family)!;
    const [dx, dy, dz] = n === 1 ? [0, 0, 0] : fib(k, n, 0.55 + Math.sqrt(n) * 0.17);
    nodes.push({ id: it.id, family: it.os_family, x: cx + dx, y: cy + dy, z: cz + dz, hub: k === 0 });
    byFamily.set(it.os_family, [...(byFamily.get(it.os_family) ?? []), idx]);
  });
  const edges: [number, number][] = [];
  for (const idxs of byFamily.values()) {
    for (let i = 1; i < idxs.length; i++) {
      edges.push([idxs[0], idxs[i]]);
      if (i > 1 && i % 2 === 0) edges.push([idxs[i - 1], idxs[i]]);
    }
  }
  const hubs = families.map((f) => byFamily.get(f)![0]);
  hubs.forEach((h, i) => edges.push([h, hubs[(i + 1) % hubs.length]]));
  return { nodes, edges: edges.filter(([a, b]) => a !== b) };
}

/** Screen-space (x,y in 0..100) projection used by the WebGL-less fallback map. */
export function flatten(layout: Layout): { id: string; x: number; y: number }[] {
  const xs = layout.nodes.map((n) => n.x + n.z * 0.35);
  const ys = layout.nodes.map((n) => n.y - n.z * 0.2);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return layout.nodes.map((n, i) => ({
    id: n.id,
    x: 6 + ((xs[i] - minX) / (maxX - minX || 1)) * 88,
    y: 8 + ((ys[i] - minY) / (maxY - minY || 1)) * 84,
  }));
}
