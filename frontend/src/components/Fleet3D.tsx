import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { layoutFleet } from "../lib/layout";
import { nodeColor, type FleetMapProps } from "./mapShared";

const WHITE = new THREE.Color("#c8faff");
const DIM = new THREE.Color("#1a2130");

function Scene({ items, selectedId, onSelect, onHover, dimIds, colorMode = "readiness", reduceMotion, activeRef }: FleetMapProps & { activeRef: React.MutableRefObject<boolean> }) {
  const group = useRef<THREE.Group>(null!);
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const pulses = useRef<THREE.BufferGeometry>(null!);
  const rot = useRef({ x: 0, y: 0 });
  const hover = useRef<number | null>(null);
  const { camera, size, gl } = useThree();

  const layout = useMemo(() => layoutFleet(items), [items]);
  const ordered = useMemo(() => {
    const by = new Map(items.map((i) => [i.id, i]));
    return layout.nodes.map((n) => by.get(n.id)!);
  }, [items, layout]);
  const n = ordered.length;
  const prox = useRef(new Float32Array(n));
  useEffect(() => { prox.current = new Float32Array(n); }, [n]);

  const baseColors = useMemo(() => ordered.map((it) => new THREE.Color(nodeColor(it, colorMode))), [ordered, colorMode]);
  const baseScale = useMemo(() => ordered.map((it) => 0.075 + it.criticality * 0.022), [ordered]);
  const selIdx = useMemo(() => (selectedId ? layout.nodes.findIndex((nn) => nn.id === selectedId) : -1), [layout, selectedId]);

  const edgePositions = useMemo(() => {
    const a = new Float32Array(layout.edges.length * 6);
    layout.edges.forEach(([i, j], k) => {
      const p = layout.nodes[i], q = layout.nodes[j];
      a.set([p.x, p.y, p.z, q.x, q.y, q.z], k * 6);
    });
    return a;
  }, [layout]);
  const hotEdges = useMemo(() => {
    const idx = layout.edges.map((e, k) => [e, k] as const).filter(([e]) => selIdx >= 0 && (e[0] === selIdx || e[1] === selIdx));
    const a = new Float32Array(idx.length * 6);
    idx.forEach(([, k], o) => a.set(edgePositions.subarray(k * 6, k * 6 + 6), o * 6));
    return a;
  }, [layout, selIdx, edgePositions]);

  const PULSES = 20;
  const pulsePos = useMemo(() => new Float32Array(PULSES * 3), []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), v: new THREE.Vector3(), c: new THREE.Color(), q: new THREE.Quaternion(), s: new THREE.Vector3(), p: new THREE.Vector3() }), []);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime;
    const px = reduceMotion ? 0 : state.pointer.x;
    const py = reduceMotion ? 0 : state.pointer.y;
    const k = Math.min(1, dt * 3);
    rot.current.x += (-py * 0.28 - rot.current.x) * k;
    rot.current.y += (px * 0.5 - rot.current.y) * k;
    group.current.rotation.set(rot.current.x, rot.current.y + (reduceMotion ? 0 : t * 0.05), 0);
    camera.position.x += (px * 0.7 - camera.position.x) * k;
    camera.position.y += (py * 0.45 - camera.position.y) * k;
    camera.lookAt(0, 0, 0);
    group.current.updateMatrixWorld();

    const aspect = size.width / size.height;
    const active = activeRef.current;
    for (let i = 0; i < n; i++) {
      const node = layout.nodes[i];
      tmp.v.set(node.x, node.y, node.z).applyMatrix4(group.current.matrixWorld).project(camera);
      const d = Math.hypot((tmp.v.x - state.pointer.x) * aspect, tmp.v.y - state.pointer.y);
      const target = active ? Math.max(0, 1 - d / 0.3) : 0;
      prox.current[i] += (target - prox.current[i]) * Math.min(1, dt * 9);
      const dimmed = !!dimIds && dimIds.has(ordered[i].id);
      const isSel = i === selIdx;
      const s = baseScale[i] * (1 + prox.current[i] * 0.95 + (isSel ? 0.9 : 0) + (hover.current === i ? 0.4 : 0)) * (dimmed ? 0.6 : 1);
      tmp.s.set(s, s, s);
      tmp.p.set(node.x, node.y, node.z);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      mesh.current.setMatrixAt(i, tmp.m);
      tmp.c.copy(baseColors[i]);
      if (dimmed) tmp.c.lerp(DIM, 0.8);
      tmp.c.lerp(WHITE, Math.min(0.75, prox.current[i] * 0.6 + (isSel ? 0.5 : 0)));
      mesh.current.setColorAt(i, tmp.c);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;

    if (!reduceMotion && layout.edges.length) {
      for (let p = 0; p < PULSES; p++) {
        const e = layout.edges[(p * 7) % layout.edges.length];
        const f = (t * 0.22 + p * 0.173) % 1;
        const a = layout.nodes[e[0]], b = layout.nodes[e[1]];
        pulsePos[p * 3] = a.x + (b.x - a.x) * f;
        pulsePos[p * 3 + 1] = a.y + (b.y - a.y) * f;
        pulsePos[p * 3 + 2] = a.z + (b.z - a.z) * f;
      }
      pulses.current.attributes.position.needsUpdate = true;
    }
  });

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const id = e.instanceId ?? null;
    if (id !== hover.current) {
      hover.current = id;
      gl.domElement.style.cursor = id === null ? "" : "pointer";
      onHover?.(id === null ? null : ordered[id].id);
    }
  };
  const handleOut = () => {
    hover.current = null;
    gl.domElement.style.cursor = "";
    onHover?.(null);
  };

  return (
    <>
      <fog attach="fog" args={["#0b0e13", 9, 21]} />
      <ambientLight intensity={0.55} />
      <pointLight position={[6, 6, 8]} intensity={90} color="#8af2ff" />
      <pointLight position={[-8, -4, -4]} intensity={50} color="#7aa7ff" />
      <group ref={group}>
        <mesh>
          <icosahedronGeometry args={[1.25, 1]} />
          <meshBasicMaterial wireframe color="#3de8ff" transparent opacity={0.16} />
        </mesh>
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" array={edgePositions} count={edgePositions.length / 3} itemSize={3} />
          </bufferGeometry>
          <lineBasicMaterial color="#3de8ff" transparent opacity={0.13} />
        </lineSegments>
        {hotEdges.length > 0 && (
          <lineSegments key={selIdx}>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" array={hotEdges} count={hotEdges.length / 3} itemSize={3} />
            </bufferGeometry>
            <lineBasicMaterial color="#c8faff" transparent opacity={0.7} />
          </lineSegments>
        )}
        <instancedMesh ref={mesh} args={[undefined, undefined, n]} onPointerMove={handleMove} onPointerOut={handleOut}
          onClick={(e) => { e.stopPropagation(); if (e.instanceId !== undefined) onSelect?.(ordered[e.instanceId].id); }}>
          <sphereGeometry args={[1, 18, 14]} />
          <meshStandardMaterial roughness={0.35} metalness={0.2} emissiveIntensity={0.35} emissive="#102030" />
        </instancedMesh>
        {!reduceMotion && (
          <points>
            <bufferGeometry ref={pulses}>
              <bufferAttribute attach="attributes-position" array={pulsePos} count={PULSES} itemSize={3} />
            </bufferGeometry>
            <pointsMaterial color="#c8faff" size={0.09} sizeAttenuation transparent opacity={0.95} depthWrite={false} />
          </points>
        )}
      </group>
    </>
  );
}

export default function Fleet3D(props: FleetMapProps) {
  const activeRef = useRef(false);
  return (
    <div className="h-full w-full" onPointerEnter={() => (activeRef.current = true)} onPointerMove={() => (activeRef.current = true)} onPointerLeave={() => (activeRef.current = false)}>
      <Canvas dpr={[1, 2]} camera={{ position: [0, 0, 14.5], fov: 42 }} gl={{ antialias: true, powerPreference: "high-performance" }}>
        <Scene {...props} activeRef={activeRef} />
      </Canvas>
    </div>
  );
}
