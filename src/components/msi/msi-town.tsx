"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import type { BusinessBranch } from "@/app/admin/msi/actions";
import { money, pct } from "@/components/msi/msi-ui";
import { short } from "@/components/msi/msi-overview";

// The business as a small animated service centre (three.js, isometric): each building is a part of after-sales and
// carries a LIVE card with its numbers - the sales tower fills up floor by floor with the month, the workshop has as
// many cars in its bays as it has open job cards, customers walk into reception, cars drive round. All branches together
// or one branch. Numbers come from the portal and the Major Service Indicators report.

type Totals = {
  sold: number | null;
  vsPlan: number | null;
  forecastVsTarget: number | null;
  openWips: number;
  oldWips: number;
  openWipValue: number;
  warrantyClaims: number;
  techWaiting: number;
  complaints: number;
  complaintsOpen: number;
  queueToday: number;
  queueWaiting: number;
};

function totalsOf(list: BusinessBranch[]): Totals {
  const sum = (f: (b: BusinessBranch) => number) => list.reduce((n, b) => n + f(b), 0);
  const withSales = list.filter((b) => b.sold != null);
  const sold = withSales.length ? sum((b) => b.sold ?? 0) : null;
  // Against plan for all branches together: sold / what the plan expected (each branch's sold / its vs-plan).
  const planned = withSales.reduce((n, b) => n + (b.vsPlan ? (b.sold ?? 0) / b.vsPlan : 0), 0);
  const fc = list.filter((b) => b.forecastVsTarget != null && b.sold != null);
  return {
    sold,
    vsPlan: list.length === 1 ? list[0].vsPlan : sold != null && planned > 0 ? sold / planned : null,
    forecastVsTarget: list.length === 1 ? list[0].forecastVsTarget : fc.length ? fc.reduce((n, b) => n + (b.forecastVsTarget ?? 0) * (b.sold ?? 0), 0) / (fc.reduce((n, b) => n + (b.sold ?? 0), 0) || 1) : null,
    openWips: sum((b) => b.openWips),
    oldWips: sum((b) => b.oldWips),
    openWipValue: sum((b) => b.openWipValue),
    warrantyClaims: sum((b) => b.warrantyClaims),
    techWaiting: sum((b) => b.techWaiting),
    complaints: sum((b) => b.complaints),
    complaintsOpen: sum((b) => b.complaintsOpen),
    queueToday: sum((b) => b.queueToday),
    queueWaiting: sum((b) => b.queueWaiting),
  };
}

const statusOf = (v: number | null) => (v == null ? null : v >= 1 ? "good" : v >= 0.9 ? "warn" : "bad");
const STATUS = { good: { c: "#248a3d", t: "✓ On track" }, warn: { c: "#b45309", t: "! Close" }, bad: { c: "#d70015", t: "↓ Behind" } } as const;

type CardId = "sales" | "workshop" | "reception" | "warranty" | "care";
/** Where each card hangs (a point on its building) and on which side of it the card sits (CSS translate). */
const ANCHOR: Record<CardId, [number, number, number]> = {
  sales: [7.8, 4.2, -3.6],
  workshop: [-8.5, 3.2, -3.6],
  reception: [2.6, 1.2, 2.4],
  warranty: [1.6, 2.6, -4.4],
  care: [-6.5, 1.0, 5.4],
};
const SIDE: Record<CardId, string> = {
  sales: "translate(18px, -50%)",
  workshop: "translate(calc(-100% - 18px), -40%)",
  reception: "translate(18px, 8px)",
  warranty: "translate(-50%, calc(-100% - 18px))",
  care: "translate(calc(-100% - 18px), 0)",
};

export function ServiceTown({ branches }: { branches: BusinessBranch[] }) {
  const [code, setCode] = useState<string>("ALL");
  const list = useMemo(() => (code === "ALL" ? branches : branches.filter((b) => b.code === code)), [branches, code]);
  const t = useMemo(() => totalsOf(list), [list]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Branch">
        {[{ code: "ALL", name: "All branches" }, ...branches].map((b) => (
          <button
            key={b.code}
            type="button"
            onClick={() => setCode(b.code)}
            aria-pressed={b.code === code}
            className={`rounded-full px-3 py-1 text-[13px] font-semibold ring-1 transition ${b.code === code ? "bg-[#1d1d1f] text-white ring-[#1d1d1f]" : "bg-white text-[#1d1d1f] ring-black/10 hover:bg-[#f5f5f7]"}`}
          >
            {b.name}
          </button>
        ))}
      </div>
      <Town totals={t} scale={code === "ALL" ? branches.length || 1 : 1} />
      <p className="text-xs text-[#6e6e73]">
        Sales tower: floors light up with the sales against the plan for today. Workshop: one car in a bay for every few open job cards. Reception: customers walking in today. Drag to turn, scroll to zoom.
      </p>
    </div>
  );
}

type Row = { label: string; value: string; color?: string };

function Card({ id, title, icon, rows, setEl }: { id: CardId; title: string; icon: string; rows: Row[]; setEl: (id: CardId, el: HTMLDivElement | null) => void }) {
  return (
    <div
      ref={(el) => setEl(id, el)}
      className="pointer-events-none absolute top-0 left-0 w-48 rounded-xl bg-white/95 px-3 py-2 text-[12px] text-[#1d1d1f] shadow-[0_6px_20px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.06] will-change-transform"
      style={{ visibility: "hidden" }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-bold">
          <span aria-hidden="true">{icon}</span>
          {title}
        </span>
        <span className="flex items-center gap-1 text-[10px] font-bold text-[#d70015]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#d70015]" />
          LIVE
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between gap-3 leading-5">
          <span className="text-[#6e6e73]">{r.label}</span>
          <span className="font-semibold tabular-nums" style={r.color ? { color: r.color } : undefined}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function Town({ totals, scale }: { totals: Totals; scale: number }) {
  const host = useRef<HTMLDivElement>(null);
  const cards = useRef<Partial<Record<CardId, HTMLDivElement | null>>>({});
  const dots = useRef<Partial<Record<CardId, HTMLSpanElement | null>>>({});
  const api = useRef<{ update: (t: Totals, scale: number) => void } | null>(null);
  const latest = useRef({ totals, scale });
  useEffect(() => {
    latest.current = { totals, scale };
    api.current?.update(totals, scale);
  }, [totals, scale]);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const T3 = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      const el = host.current;
      if (disposed || !el) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const renderer = new T3.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T3.PCFSoftShadowMap;
      el.appendChild(renderer.domElement);
      const scene = new T3.Scene();
      scene.background = new T3.Color(0xefe9df);

      // Isometric: an orthographic camera looking down at 45 degrees.
      const camera = new T3.OrthographicCamera(-1, 1, 1, -1, -100, 200);
      camera.position.set(22, 20, 22);
      camera.zoom = 1;
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.enablePan = false;
      controls.minZoom = 0.7;
      controls.maxZoom = 2.6;
      controls.minPolarAngle = Math.PI * 0.18;
      controls.maxPolarAngle = Math.PI * 0.36;
      controls.target.set(0, 1.4, 0.5);

      scene.add(new T3.HemisphereLight(0xffffff, 0xd9cdb8, 1.4));
      const sun = new T3.DirectionalLight(0xfff3e0, 1.9);
      sun.position.set(-12, 24, 10);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16 });
      sun.shadow.bias = -0.0005;
      scene.add(sun);

      const mats = new Map<number, THREE.MeshStandardMaterial>();
      const mat = (c: number) => {
        if (!mats.has(c)) mats.set(c, new T3.MeshStandardMaterial({ color: c, roughness: 0.75, flatShading: true }));
        return mats.get(c)!;
      };
      const box = (w: number, h: number, d: number, c: number, x: number, y: number, z: number, parent: THREE.Object3D = scene) => {
        const m = new T3.Mesh(new T3.BoxGeometry(w, h, d), mat(c));
        m.position.set(x, y + h / 2, z);
        m.castShadow = true;
        m.receiveShadow = true;
        parent.add(m);
        return m;
      };

      // ---- the slab, roads, parking
      box(23, 0.6, 15, 0xf7f5f1, 0, -0.6, 0.5);
      box(23.2, 0.08, 15.2, 0xd8d3ca, 0, -0.68, 0.5);
      const road = 0xc9c6c0;
      box(21.4, 0.03, 1.1, road, 0, 0, -6.1);
      box(21.4, 0.03, 1.1, road, 0, 0, 7.1);
      box(1.1, 0.03, 14.3, road, -10.15, 0, 0.5);
      box(1.1, 0.03, 14.3, road, 10.15, 0, 0.5);
      for (let i = -9; i <= 9; i += 2) {
        box(0.6, 0.035, 0.08, 0xffffff, i, 0, -6.1);
        box(0.6, 0.035, 0.08, 0xffffff, i, 0, 7.1);
      }
      box(5.2, 0.03, 4.4, 0xdedad3, 6.6, 0, 3.6);
      for (let i = 0; i < 5; i++) box(0.06, 0.04, 1.6, 0xffffff, 4.4 + i * 1.1, 0, 2.6);
      for (let i = 0; i < 5; i++) box(0.06, 0.04, 1.6, 0xffffff, 4.4 + i * 1.1, 0, 4.7);

      // ---- trees
      const tree = (x: number, z: number, s = 1) => {
        const g = new T3.Group();
        box(0.16 * s, 0.5 * s, 0.16 * s, 0x8a6a4a, 0, 0, 0, g);
        const top = new T3.Mesh(new T3.IcosahedronGeometry(0.42 * s, 0), mat(0x5aa86a));
        top.position.y = 0.75 * s;
        top.castShadow = true;
        g.add(top);
        g.position.set(x, 0, z);
        scene.add(g);
        return g;
      };
      const trees = [
        [-11, -7], [-8, -7.2], [-4, -7.3], [0.5, -7.3], [4.5, -7.3], [8.5, -7.2], [11, -6], [11, 0], [11, 5], [11, 8], [7, 8.3], [2, 8.3], [-2.5, 8.3], [-7, 8.3], [-11, 8], [-11, 3], [-11, -2],
      ].map(([x, z], i) => tree(x, z, 0.85 + (i % 3) * 0.12));

      // ---- workshop: blue shed with a saw-tooth roof, bays in front
      const ws = new T3.Group();
      scene.add(ws);
      box(7.2, 2.3, 4.2, 0x3557c8, -6.2, 0, -3.6, ws);
      for (let i = 0; i < 4; i++) {
        const prism = new T3.Mesh(new T3.CylinderGeometry(0.9, 0.9, 4.2, 3), mat(0x2b47a8));
        prism.rotation.x = Math.PI / 2;
        prism.rotation.z = Math.PI / 2;
        prism.position.set(-8.9 + i * 1.8, 2.75, -3.6);
        prism.castShadow = true;
        ws.add(prism);
      }
      for (let i = 0; i < 4; i++) box(1.5, 1.6, 0.06, 0xdfe6f5, -8.9 + i * 1.8, 0, -1.47, ws);
      const bayPads: THREE.Vector3[] = [];
      for (let i = 0; i < 4; i++) {
        box(1.55, 0.03, 2.4, 0xe4e1da, -8.9 + i * 1.8, 0, 0.0);
        bayPads.push(new T3.Vector3(-8.9 + i * 1.8, 0, 0.1));
      }
      // crates beside the workshop
      box(0.6, 0.5, 0.6, 0xc9965a, -2.2, 0, -2.2);
      box(0.5, 0.45, 0.5, 0xb9864a, -2.3, 0.5, -2.2);
      box(0.55, 0.5, 0.55, 0xc9965a, -1.6, 0, -1.6);

      // ---- cars
      const CAR_COLORS = [0xffffff, 0x1d1d1f, 0xc4121a, 0x8e9196, 0x2e5fa8, 0xd9d4c7];
      const car = (color: number) => {
        const g = new T3.Group();
        box(1.0, 0.32, 0.5, color, 0, 0.12, 0, g);
        box(0.55, 0.26, 0.44, color === 0x1d1d1f ? 0x3a3a3c : 0xdbe7f2, -0.05, 0.44, 0, g);
        for (const [x, z] of [[-0.32, 0.25], [0.32, 0.25], [-0.32, -0.25], [0.32, -0.25]]) {
          const w = new T3.Mesh(new T3.CylinderGeometry(0.12, 0.12, 0.1, 10), mat(0x222222));
          w.rotation.x = Math.PI / 2;
          w.position.set(x, 0.12, z);
          g.add(w);
        }
        g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
        scene.add(g);
        return g;
      };
      // In the bays (one shown per few open job cards), one on a lift going up and down.
      const bayCars = bayPads.map((p, i) => {
        const c = car(CAR_COLORS[(i + 2) % CAR_COLORS.length]);
        c.position.copy(p);
        c.rotation.y = Math.PI / 2;
        return c;
      });
      const lift = box(1.2, 0.08, 0.7, 0xf2b705, bayPads[1].x, 0, bayPads[1].z);
      // Parked
      [[4.4, 2.6, 0], [6.6, 2.6, 2], [7.7, 4.7, 4], [5.5, 4.7, 1], [8.8, 2.6, 5]].forEach(([x, z, c]) => {
        const p = car(CAR_COLORS[c]);
        p.position.set(x + 0.55, 0, z);
        p.rotation.y = Math.PI / 2;
      });
      // Driving round the block.
      const loop = new T3.CurvePath<THREE.Vector3>();
      const corners = [new T3.Vector3(-10.15, 0, -6.1), new T3.Vector3(10.15, 0, -6.1), new T3.Vector3(10.15, 0, 7.1), new T3.Vector3(-10.15, 0, 7.1)];
      corners.forEach((c, i) => loop.add(new T3.LineCurve3(c, corners[(i + 1) % 4])));
      const movers = [0, 0.27, 0.52, 0.78].map((p, i) => ({ car: car(CAR_COLORS[i]), p, speed: 0.018 + i * 0.002 }));

      // ---- sales tower: floors that light up with the sales against plan
      const FLOORS = 10;
      const floors: THREE.Mesh[] = [];
      for (let i = 0; i < FLOORS; i++) {
        const f = new T3.Mesh(new T3.BoxGeometry(2.4, 0.46, 2.4), new T3.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.4, flatShading: true }));
        f.position.set(6.6, 0.25 + i * 0.52 + 0.23, -3.6);
        f.castShadow = true;
        f.receiveShadow = true;
        scene.add(f);
        floors.push(f);
        box(2.5, 0.06, 2.5, 0xffffff, 6.6, 0.25 + i * 0.52 + 0.46, -3.6);
      }
      box(2.7, 0.25, 2.7, 0xb8b2a6, 6.6, 0, -3.6);
      box(0.8, 0.3, 0.8, 0xe8e4dc, 6.6, 0.25 + FLOORS * 0.52, -3.6);

      // ---- warranty office: red roof
      box(3.2, 2.2, 2.6, 0xfafafa, 1.6, 0, -4.4);
      box(3.4, 0.25, 2.8, 0xc4121a, 1.6, 2.2, -4.4);
      for (let i = 0; i < 3; i++) box(0.6, 0.6, 0.05, 0x9fc3e6, 0.6 + i * 1.0, 1.1, -3.08);

      // ---- reception with the MG sign
      box(3.2, 1.5, 2.2, 0xffffff, 1.4, 0, 1.6);
      box(3.4, 0.16, 2.4, 0x2d2d2f, 1.4, 1.5, 1.6);
      box(1.0, 0.5, 0.06, 0xc4121a, 1.4, 1.75, 2.72);
      box(0.9, 1.0, 0.05, 0x9fc3e6, 1.4, 0, 2.72);

      // ---- customer care: coloured booths
      const BOOTH = [0xf27aa6, 0xa78bfa, 0x34c4a0, 0x60a5fa, 0xfdba74];
      BOOTH.forEach((c, i) => {
        const x = -6 + i * 1.3;
        box(1.1, 0.7, 0.9, 0xffffff, x, 0, 5.2);
        const roof = box(1.2, 0.12, 1.1, c, x, 0.95, 5.1);
        roof.rotation.x = -0.2;
        box(0.06, 0.95, 0.06, 0xbbbbbb, x - 0.5, 0, 5.6);
        box(0.06, 0.95, 0.06, 0xbbbbbb, x + 0.5, 0, 5.6);
      });

      // ---- people: customers walking from the parking to reception
      const person = (c: number) => {
        const g = new T3.Group();
        const body = new T3.Mesh(new T3.CylinderGeometry(0.11, 0.14, 0.42, 8), mat(c));
        body.position.y = 0.21;
        const head = new T3.Mesh(new T3.SphereGeometry(0.1, 10, 8), mat(0xe8c39e));
        head.position.y = 0.52;
        g.add(body, head);
        g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
        scene.add(g);
        return g;
      };
      const walkPath = new T3.CatmullRomCurve3([new T3.Vector3(5.2, 0, 3.6), new T3.Vector3(3.6, 0, 3.4), new T3.Vector3(2.2, 0, 3.2), new T3.Vector3(1.4, 0, 2.9)]);
      const PEOPLE_COLORS = [0x3b82f6, 0xef4444, 0x10b981, 0xf59e0b, 0x8b5cf6, 0x111827, 0xec4899, 0x14b8a6];
      const walkers = PEOPLE_COLORS.map((c, i) => ({ g: person(c), p: i / PEOPLE_COLORS.length, on: false }));
      // People at the booths (complaints being handled)
      const boothPeople = BOOTH.map((_, i) => {
        const g = person(PEOPLE_COLORS[(i + 3) % PEOPLE_COLORS.length]);
        g.position.set(-6 + i * 1.3, 0, 6.0);
        return g;
      });

      // ---- the numbers change what the town shows
      const lit = new T3.Color();
      const update = (t: Totals, sc: number) => {
        const s = statusOf(t.vsPlan);
        lit.set(s ? STATUS[s].c : "#8e8e93");
        const n = t.vsPlan == null ? 0 : Math.round(Math.min(1, t.vsPlan) * FLOORS);
        floors.forEach((f, i) => (f.material as THREE.MeshStandardMaterial).color.set(i < n ? lit : new T3.Color(0xd8dde3)));
        // About one car per 15 open job cards per branch, at least one when there is any.
        const perBranch = t.openWips / Math.max(1, sc);
        const cars = t.openWips === 0 ? 0 : Math.max(1, Math.min(4, Math.round(perBranch / 15)));
        bayCars.forEach((c, i) => (c.visible = i < cars));
        lift.visible = cars > 1;
        const walking = t.queueToday === 0 ? 0 : Math.max(1, Math.min(walkers.length, Math.round(t.queueToday / Math.max(1, sc) / 3)));
        walkers.forEach((w, i) => ((w.on = i < walking), (w.g.visible = w.on)));
        const atBooths = t.complaintsOpen === 0 ? 0 : Math.max(1, Math.min(BOOTH.length, t.complaintsOpen));
        boothPeople.forEach((g, i) => (g.visible = i < atBooths));
      };
      api.current = { update };
      update(latest.current.totals, latest.current.scale);

      const size = () => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        renderer.setSize(w, h);
        const a = w / h;
        // Fit the town's width on a narrow (phone) screen, its height on a wide one.
        const view = Math.max(9.6, 14.5 / a);
        Object.assign(camera, { left: -view * a, right: view * a, top: view, bottom: -view });
        camera.updateProjectionMatrix();
      };
      size();
      const ro = new ResizeObserver(size);
      ro.observe(el);

      const clock = new T3.Clock();
      const v = new T3.Vector3();
      let frame = 0;
      const tick = () => {
        frame = requestAnimationFrame(tick);
        const dt = Math.min(0.05, clock.getDelta());
        const time = clock.elapsedTime;
        if (!reduce) {
          for (const m of movers) {
            m.p = (m.p + m.speed * dt) % 1;
            const pos = loop.getPointAt(m.p);
            const ahead = loop.getPointAt((m.p + 0.002) % 1);
            m.car.position.set(pos.x, 0, pos.z);
            m.car.rotation.y = Math.atan2(-(ahead.z - pos.z), ahead.x - pos.x);
          }
          for (const w of walkers) {
            if (!w.on) continue;
            w.p = (w.p + 0.06 * dt) % 1;
            const pos = walkPath.getPointAt(w.p);
            w.g.position.set(pos.x, Math.abs(Math.sin(time * 9 + w.p * 20)) * 0.04, pos.z);
            w.g.scale.setScalar(w.p > 0.92 ? Math.max(0.01, (1 - w.p) / 0.08) : 1);
          }
          const up = 0.45 + Math.sin(time * 0.8) * 0.4;
          lift.position.y = up;
          bayCars[1].position.y = up + 0.04;
          trees.forEach((tr, i) => (tr.rotation.z = Math.sin(time * 1.2 + i) * 0.03));
        } else {
          movers.forEach((m) => {
            const pos = loop.getPointAt(m.p);
            m.car.position.set(pos.x, 0, pos.z);
          });
          walkers.forEach((w) => {
            const pos = walkPath.getPointAt(w.p);
            w.g.position.set(pos.x, 0, pos.z);
          });
        }
        controls.update();
        renderer.render(scene, camera);
        // Cards follow their buildings.
        const r = el.getBoundingClientRect();
        (Object.keys(ANCHOR) as CardId[]).forEach((id) => {
          const c = cards.current[id];
          if (!c) return;
          v.set(...ANCHOR[id]).project(camera);
          const x = ((v.x + 1) / 2) * r.width;
          const y = ((1 - v.y) / 2) * r.height;
          c.style.transform = `translate(${x}px, ${y}px) ${SIDE[id]}`;
          c.style.visibility = "visible";
          const dot = dots.current[id];
          if (dot) {
            dot.style.transform = `translate(${x - 4}px, ${y - 4}px)`;
            dot.style.visibility = "visible";
          }
        });
      };
      tick();

      cleanup = () => {
        cancelAnimationFrame(frame);
        ro.disconnect();
        controls.dispose();
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          mesh.geometry?.dispose();
          const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
          (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => x.dispose());
        });
        renderer.dispose();
        renderer.domElement.remove();
        api.current = null;
      };
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  const s = statusOf(totals.vsPlan);
  const setEl = (id: CardId, el: HTMLDivElement | null) => {
    cards.current[id] = el;
  };
  const list: { id: CardId; icon: string; title: string; rows: Row[] }[] = [
    {
      id: "sales",
      icon: "📈",
      title: "Sales",
      rows: [
        { label: "Sold", value: totals.sold == null ? "—" : `SAR ${short(totals.sold)}` },
        { label: "vs plan", value: s ? `${pct(totals.vsPlan)} ${STATUS[s].t}` : "—", color: s ? STATUS[s].c : undefined },
        { label: "Month end", value: totals.forecastVsTarget == null ? "—" : `${pct(totals.forecastVsTarget)} of target` },
      ],
    },
    {
      id: "workshop",
      icon: "🔧",
      title: "Workshop",
      rows: [
        { label: "Open WIPs", value: money(totals.openWips) },
        { label: "Over 30 days", value: money(totals.oldWips), color: totals.oldWips > 0 ? "#d70015" : "#248a3d" },
        { label: "Value", value: `SAR ${short(totals.openWipValue)}` },
      ],
    },
    {
      id: "reception",
      icon: "👥",
      title: "Customers",
      rows: [
        { label: "Today", value: money(totals.queueToday) },
        { label: "Waiting now", value: money(totals.queueWaiting), color: totals.queueWaiting > 5 ? "#b45309" : undefined },
      ],
    },
    {
      id: "warranty",
      icon: "🛡️",
      title: "Warranty",
      rows: [
        { label: "Claims this year", value: money(totals.warrantyClaims) },
        { label: "Tech. claims waiting", value: money(totals.techWaiting), color: totals.techWaiting > 0 ? "#b45309" : "#248a3d" },
      ],
    },
    {
      id: "care",
      icon: "💬",
      title: "Complaints",
      rows: [
        { label: "This year", value: money(totals.complaints) },
        { label: "Still open", value: money(totals.complaintsOpen), color: totals.complaintsOpen > 0 ? "#d70015" : "#248a3d" },
      ],
    },
  ];
  return (
    <>
      <div className="relative h-[clamp(360px,72vh,760px)] max-sm:h-[300px] w-full overflow-hidden rounded-2xl bg-[#efe9df] ring-1 ring-black/[0.06]">
        <div ref={host} className="absolute inset-0" />
        {/* On a computer the cards hang beside their buildings; on a phone they are listed under the picture. */}
        <div className="max-sm:hidden">
          {list.map((c) => (
            <span
              key={c.id}
              ref={(el) => {
                dots.current[c.id] = el;
              }}
              className="pointer-events-none absolute top-0 left-0 h-2 w-2 rounded-full bg-[#1d1d1f] ring-2 ring-white"
              style={{ visibility: "hidden" }}
            />
          ))}
          {list.map((c) => (
            <Card key={c.id} id={c.id} setEl={setEl} icon={c.icon} title={c.title} rows={c.rows} />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:hidden">
        {list.map((c) => (
          <div key={c.id} className="rounded-xl bg-white px-3 py-2 text-[12px] shadow-sm ring-1 ring-black/[0.06]">
            <div className="mb-1 flex items-center gap-1.5 font-bold">
              <span aria-hidden="true">{c.icon}</span>
              {c.title}
            </div>
            {c.rows.map((r) => (
              <div key={r.label} className="flex justify-between gap-2 leading-5">
                <span className="text-[#6e6e73]">{r.label}</span>
                <span className="font-semibold tabular-nums" style={r.color ? { color: r.color } : undefined}>
                  {r.value}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
