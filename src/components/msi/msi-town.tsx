"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import { getTownDetails, type BusinessBranch } from "@/app/admin/msi/actions";
import type { TownDetails } from "@/lib/msi/town";
import { money, pct, MONTHS } from "@/components/msi/msi-ui";
import { short } from "@/components/msi/msi-overview";
import { DEPT_TITLE, DeptPanel, type Dept } from "@/components/msi/msi-town-panel";

// The business as a small animated service centre (three.js, isometric). Five buildings: the workshop, reception (sales
// and customers), the warranty office, the warranty room (scrap and the audits) and the customer-care booths. Each carries
// a LIVE card. Clicking a building flies the camera to it: its walls fade away and its figures stand up inside as 3D
// bars, stacks and gauges with number boards, and the department's details open beside it. All branches or one branch.

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
const GOOD = "#248a3d";
const WARN = "#b45309";
const BAD = "#d70015";

/** Each building: where it stands (the camera flies there) and where its card hangs. */
const BUILDING: Record<Dept, { center: [number, number, number]; card: [number, number, number]; side: string }> = {
  workshop: { center: [-6.2, 1.1, -3.6], card: [-8.5, 3.2, -3.6], side: "translate(calc(-100% - 18px), -40%)" },
  reception: { center: [1.4, 0.8, 1.6], card: [1.6, 1.0, 2.9], side: "translate(-40%, 20px)" },
  warranty: { center: [1.6, 1.0, -4.4], card: [1.6, 2.6, -4.4], side: "translate(-50%, calc(-100% - 18px))" },
  room: { center: [6.6, 0.9, -3.6], card: [8.3, 1.6, -3.6], side: "translate(18px, -50%)" },
  care: { center: [-3.4, 0.6, 5.0], card: [-3.4, 0.4, 6.0], side: "translate(-50%, 18px)" },
};
const DEPTS = Object.keys(BUILDING) as Dept[];

/** Number boards that stand inside a building while it is open (static spots, or on top of a 3D bar). */
type Board = { id: string; dept: Dept; at: [number, number, number]; small?: boolean };
const AGE_LABELS = ["0-7 d", "8-15 d", "16-30 d", "31-60 d", "60+ d"];
const BOARDS: Board[] = [
  { id: "w_open", dept: "workshop", at: [-6.2, 4.2, -4.6] },
  { id: "w_overdue", dept: "workshop", at: [-10.4, 2.6, -2.4] },
  { id: "w_age", dept: "workshop", at: [-1.8, 2.8, -3.6] },
  { id: "w_parts", dept: "workshop", at: [-6.2, 0.4, 0.9] },
  ...AGE_LABELS.map((_, i) => ({ id: `w_bar${i}`, dept: "workshop" as Dept, at: [0, 0, 0] as [number, number, number], small: true })),
  { id: "r_sold", dept: "reception", at: [0.4, 3.2, 0.8] },
  { id: "r_month", dept: "reception", at: [-1.8, 1.2, 3.0] },
  { id: "r_cust", dept: "reception", at: [4.2, 1.6, 3.0] },
  { id: "o_claims", dept: "warranty", at: [1.6, 3.2, -4.4] },
  { id: "o_settled", dept: "warranty", at: [4.6, 1.4, -2.2] },
  { id: "o_prog", dept: "warranty", at: [-1.4, 1.6, -2.6] },
  { id: "o_last", dept: "warranty", at: [0, 0, 0], small: true },
  { id: "m_scrap", dept: "room", at: [4.2, 2.8, -5.4] },
  { id: "m_audit", dept: "room", at: [9.4, 2.6, -2.2] },
  { id: "m_evidence", dept: "room", at: [6.0, 0.3, -0.8] },
  { id: "c_total", dept: "care", at: [-2.2, 0.2, 7.6] },
  ...[0, 1, 2, 3, 4, 5].map((i) => ({ id: `c_bar${i}`, dept: "care" as Dept, at: [0, 0, 0] as [number, number, number], small: true })),
];

export function ServiceTown({ branches, loadDetails = getTownDetails }: { branches: BusinessBranch[]; /** Where the department details come from (a test can give its own). */ loadDetails?: typeof getTownDetails }) {
  const [code, setCode] = useState<string>("ALL");
  const list = useMemo(() => (code === "ALL" ? branches : branches.filter((b) => b.code === code)), [branches, code]);
  const t = useMemo(() => totalsOf(list), [list]);
  const [open, setOpen] = useState<Dept | null>(null);
  const [details, setDetails] = useState<Record<string, TownDetails>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (details[code]) return;
    let live = true;
    loadDetails(code === "ALL" ? null : code).then(
      (r) => {
        if (!live) return;
        if (r.details) setDetails((cur) => ({ ...cur, [code]: r.details! }));
        setError(r.error ?? null);
      },
      () => live && setError("Could not load the details."),
    );
    return () => {
      live = false;
    };
  }, [code, details, loadDetails]);
  const d = details[code] ?? null;
  // On a phone the details open under the picture: bring them into view.
  const phonePanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && window.innerWidth < 640) phonePanel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open]);
  const panel = open && <DeptPanel dept={open} details={d} branches={branches} selected={list} error={error} onClose={() => setOpen(null)} />;
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
      <Town totals={t} details={d} scale={code === "ALL" ? branches.length || 1 : 1} open={open} onOpen={setOpen} panel={panel} />
      {open && <div ref={phonePanel} className="h-[70vh] scroll-mt-20 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/[0.06] sm:hidden">{panel}</div>}
      <p className="text-xs text-[#6e6e73]">
        Click a building or its card to go inside: its walls open and its figures stand up as bars and boards, with all its details beside. Workshop: cars in the bays with the open job cards. Warranty room: crates with the scrapped parts. Reception: customers walking in today. Drag to turn, scroll to zoom.
      </p>
    </div>
  );
}

type Row = { label: string; value: string; color?: string };

function Card({ id, title, icon, rows, setEl, active, onOpen }: { id: Dept; title: string; icon: string; rows: Row[]; setEl: (id: Dept, el: HTMLDivElement | null) => void; active: boolean; onOpen: (d: Dept) => void }) {
  return (
    <div
      ref={(el) => setEl(id, el)}
      role="button"
      tabIndex={0}
      aria-label={`${title}: go inside`}
      onClick={() => onOpen(id)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(id)}
      className={`absolute top-0 left-0 w-48 cursor-pointer rounded-xl bg-white/95 px-3 py-2 text-[12px] text-[#1d1d1f] shadow-[0_6px_20px_rgba(0,0,0,0.12)] ring-1 transition-[opacity,box-shadow] duration-300 will-change-transform hover:shadow-[0_8px_28px_rgba(0,0,0,0.2)] ${active ? "ring-2 ring-[#1d1d1f]" : "ring-black/[0.06]"}`}
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

/** The content of each number board (what it says), from the figures. */
function boardContent(t: Totals, d: TownDetails | null): Record<string, { title: string; value: string; note?: string; color?: string }> {
  const out: Record<string, { title: string; value: string; note?: string; color?: string }> = {};
  const s = statusOf(t.vsPlan);
  out.r_sold = { title: "Sold this month", value: t.sold == null ? "—" : `SAR ${short(t.sold)}`, note: s ? `${pct(t.vsPlan)} of plan · ${STATUS[s].t}` : undefined, color: s ? STATUS[s].c : undefined };
  out.r_month = { title: "Month end (forecast)", value: t.forecastVsTarget == null ? "—" : `${pct(t.forecastVsTarget)} of target`, color: t.forecastVsTarget != null && t.forecastVsTarget < 0.9 ? BAD : undefined };
  out.r_cust = { title: "Customers today", value: money(t.queueToday), note: `${money(t.queueWaiting)} waiting${d ? ` · ${money(d.customers.appointments)} appointments` : ""}` };
  if (!d) return out;
  const w = d.workshop;
  out.w_open = { title: "Open WIPs", value: money(w.open), note: `SAR ${short(w.value)} to invoice` };
  out.w_overdue = { title: "Past promised date", value: money(w.overdue), note: `${pct(w.open ? w.overdue / w.open : null)} of open · ${money(w.dueToday)} due today`, color: w.overdue > 0 ? BAD : GOOD };
  out.w_age = { title: "Average age", value: w.avgAge == null ? "—" : `${w.avgAge} days`, note: "cycle time of the open job cards", color: w.avgAge != null && w.avgAge > 15 ? BAD : undefined };
  out.w_parts = { title: "Awaiting parts · done not invoiced", value: `${money(w.awaitingParts)} · ${money(w.completeNotInvoiced)}` };
  w.ageing.forEach((n, i) => (out[`w_bar${i}`] = { title: AGE_LABELS[i], value: money(n) }));
  const o = d.warranty;
  out.o_claims = { title: "Warranty claims this year", value: money(o.claims), note: `SAR ${short(o.amount)}` };
  out.o_settled = { title: "Settled", value: pct(o.claims ? o.settled / o.claims : null), note: `${o.settleDays ?? "—"} days submit to settle`, color: GOOD };
  out.o_prog = { title: "In progress", value: money(o.inProgress), note: `${money(o.returned)} returned · ${money(o.rejected)} rejected` };
  const lastM = o.months.at(-1);
  out.o_last = { title: lastM ? MONTHS[Number(lastM.m.slice(5, 7)) - 1] : "—", value: lastM ? money(lastM.n) : "—" };
  const m = d.room;
  const a = d.audit;
  out.m_scrap = { title: "Scrapped this cycle", value: `${money(m.scrappedThisCycle)} parts`, note: m.flaggedParts ? `${money(m.flaggedParts)} still to scrap` : "nothing left to scrap", color: m.flaggedParts ? WARN : GOOD };
  out.m_audit = { title: "Self-audit", value: `${a.done} / ${a.assignments}`, note: `score ${a.score ?? "—"}% · ${a.internal.count} internal audits`, color: a.assignments && a.done < a.assignments ? WARN : GOOD };
  out.m_evidence = { title: "Destroy evidence", value: `${m.evidence.approved} approved`, note: m.evidence.waiting ? `${m.evidence.waiting} waiting` : undefined };
  const c = d.complaints;
  out.c_total = { title: "Complaints this year", value: money(c.total), note: `${money(c.open)} still open · ${c.resolveDays ?? "—"} days to resolve`, color: c.open ? BAD : GOOD };
  c.categories.slice(0, 6).forEach((x, i) => (out[`c_bar${i}`] = { title: x.label, value: money(x.n) }));
  return out;
}

function Town({ totals, details, scale, open, onOpen, panel }: { totals: Totals; details: TownDetails | null; scale: number; open: Dept | null; onOpen: (d: Dept | null) => void; panel: React.ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const cards = useRef<Partial<Record<Dept, HTMLDivElement | null>>>({});
  const dots = useRef<Partial<Record<Dept, HTMLSpanElement | null>>>({});
  const boards = useRef<Record<string, HTMLDivElement | null>>({});
  const api = useRef<{ update: (t: Totals, scale: number, d: TownDetails | null) => void; focus: (d: Dept | null) => void } | null>(null);
  const latest = useRef({ totals, scale, details, open });
  const openRef = useRef(onOpen);
  useEffect(() => {
    openRef.current = onOpen;
    latest.current = { totals, scale, details, open };
    api.current?.update(totals, scale, details);
  }, [totals, scale, details, onOpen, open]);
  useEffect(() => {
    api.current?.focus(open);
  }, [open]);

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
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.enablePan = false;
      controls.minZoom = 0.7;
      controls.maxZoom = 4;
      controls.minPolarAngle = Math.PI * 0.18;
      controls.maxPolarAngle = Math.PI * 0.36;
      const HOME = new T3.Vector3(0, 1.4, 0.5);
      controls.target.copy(HOME);

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
      /** A box standing on y (its base). `own`: its own material (walls that fade when the building opens). */
      const box = (w: number, h: number, d: number, c: number, x: number, y: number, z: number, parent: THREE.Object3D = scene, own = false) => {
        const m = new T3.Mesh(new T3.BoxGeometry(w, h, d), own ? new T3.MeshStandardMaterial({ color: c, roughness: 0.75, flatShading: true, transparent: true }) : mat(c));
        m.position.set(x, y + h / 2, z);
        m.castShadow = true;
        m.receiveShadow = true;
        parent.add(m);
        return m;
      };
      /** A bar that grows from the floor: geometry with its base at 0, height = scale.y. */
      const barGeo = new T3.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      const bar = (w: number, d: number, c: number, x: number, z: number, parent: THREE.Object3D) => {
        const m = new T3.Mesh(barGeo, new T3.MeshStandardMaterial({ color: c, roughness: 0.5, flatShading: true }));
        m.scale.set(w, 0.001, d);
        m.position.set(x, 0.02, z);
        m.castShadow = true;
        parent.add(m);
        return m;
      };

      // Each building: a group that says which department it is (for clicks), its walls (fade when it opens) and its
      // inside (the figures - hidden until it opens).
      type Building = { group: THREE.Group; shell: THREE.Group; inside: THREE.Group; fade: number };
      const B = {} as Record<Dept, Building>;
      for (const dpt of DEPTS) {
        const group = new T3.Group();
        group.userData.dept = dpt;
        const shell = new T3.Group();
        const inside = new T3.Group();
        inside.visible = false;
        group.add(shell, inside);
        scene.add(group);
        B[dpt] = { group, shell, inside, fade: 1 };
      }

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
        [-11, -7], [-8, -7.2], [-4, -7.3], [0.5, -7.3], [4.5, -7.3], [8.5, -7.2], [11, -6], [11, 0], [11, 5], [11, 8], [7, 8.3], [2, 8.3], [-2.5, 8.3], [-7, 8.3], [-11, 8], [-11, 3], [-11, -2], [-9.2, 5.2], [-8.4, 4.0],
      ].map(([x, z], i) => tree(x, z, 0.85 + (i % 3) * 0.12));

      // ---- people
      const person = (c: number, parent: THREE.Object3D = scene) => {
        const g = new T3.Group();
        const body = new T3.Mesh(new T3.CylinderGeometry(0.11, 0.14, 0.42, 8), mat(c));
        body.position.y = 0.21;
        const head = new T3.Mesh(new T3.SphereGeometry(0.1, 10, 8), mat(0xe8c39e));
        head.position.y = 0.52;
        g.add(body, head);
        g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
        parent.add(g);
        return g;
      };
      const PEOPLE_COLORS = [0x3b82f6, 0xef4444, 0x10b981, 0xf59e0b, 0x8b5cf6, 0x111827, 0xec4899, 0x14b8a6];

      // ---- cars
      const CAR_COLORS = [0xffffff, 0x1d1d1f, 0xc4121a, 0x8e9196, 0x2e5fa8, 0xd9d4c7];
      const car = (color: number, parent: THREE.Object3D = scene) => {
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
        parent.add(g);
        return g;
      };

      // ================= WORKSHOP: blue shed with a saw-tooth roof, bays in front
      const W = B.workshop;
      box(7.2, 0.04, 4.2, 0xd9dde6, -6.2, 0, -3.6, W.group); // the floor (stays)
      box(7.2, 2.3, 0.12, 0x3557c8, -6.2, 0, -5.64, W.shell, true);
      box(0.12, 2.3, 4.2, 0x3557c8, -9.74, 0, -3.6, W.shell, true);
      box(0.12, 2.3, 4.2, 0x3557c8, -2.66, 0, -3.6, W.shell, true);
      box(7.2, 0.7, 0.12, 0x3557c8, -6.2, 1.6, -1.56, W.shell, true);
      for (let i = 0; i < 4; i++) {
        box(0.2, 1.6, 0.12, 0x3557c8, -9.7 + i * 1.8, 0, -1.56, W.shell, true);
        const prism = new T3.Mesh(new T3.CylinderGeometry(0.9, 0.9, 4.2, 3), new T3.MeshStandardMaterial({ color: 0x2b47a8, roughness: 0.75, flatShading: true, transparent: true }));
        prism.rotation.x = Math.PI / 2;
        prism.rotation.z = Math.PI / 2;
        prism.position.set(-8.9 + i * 1.8, 2.75, -3.6);
        prism.castShadow = true;
        W.shell.add(prism);
        box(1.5, 1.6, 0.05, 0xdfe6f5, -8.9 + i * 1.8, 0, -1.5, W.shell, true);
      }
      const bayPads: THREE.Vector3[] = [];
      for (let i = 0; i < 4; i++) {
        box(1.55, 0.03, 2.4, 0xe4e1da, -8.9 + i * 1.8, 0, 0.0, W.group);
        bayPads.push(new T3.Vector3(-8.9 + i * 1.8, 0, 0.1));
      }
      box(0.6, 0.5, 0.6, 0xc9965a, -2.2, 0, -1.2);
      box(0.5, 0.45, 0.5, 0xb9864a, -2.3, 0.5, -1.2);
      const bayCars = bayPads.map((p, i) => {
        const c = car(CAR_COLORS[(i + 2) % CAR_COLORS.length], W.group);
        c.position.copy(p);
        c.rotation.y = Math.PI / 2;
        return c;
      });
      const lift = box(1.2, 0.08, 0.7, 0xf2b705, bayPads[1].x, 0, bayPads[1].z, W.group);
      // Inside: the age of the open job cards as five bars (grey to red), cars on lifts at the back.
      const AGE_COLORS = [0xc7c7cc, 0xa1a1a6, 0x6e6e73, 0xb45309, 0xd70015];
      const ageBars = AGE_COLORS.map((c, i) => bar(0.85, 0.85, c, -8.9 + i * 1.35, -4.4, W.inside));
      for (let i = 0; i < 3; i++) {
        box(1.2, 0.08, 0.7, 0xf2b705, -8.4 + i * 2.2, 0.55, -2.7, W.inside);
        const c = car(CAR_COLORS[i], W.inside);
        c.position.set(-8.4 + i * 2.2, 0.62, -2.7);
      }

      // ================= RECEPTION (sales + customers) with the MG sign
      const R = B.reception;
      box(3.6, 0.04, 2.6, 0xeeeae2, 1.4, 0, 1.6, R.group);
      box(3.6, 1.6, 0.1, 0xffffff, 1.4, 0, 0.35, R.shell, true);
      box(0.1, 1.6, 2.6, 0xffffff, -0.4, 0, 1.6, R.shell, true);
      box(0.1, 1.6, 2.6, 0xffffff, 3.2, 0, 1.6, R.shell, true);
      box(3.6, 1.6, 0.06, 0x9fc3e6, 1.4, 0, 2.88, R.shell, true);
      box(3.8, 0.16, 2.8, 0x2d2d2f, 1.4, 1.6, 1.6, R.shell, true);
      box(1.0, 0.5, 0.06, 0xc4121a, 1.4, 1.85, 2.94, R.shell, true);
      // Inside: the sales gauge (a ring that fills with sales against plan), the counter, the waiting line.
      box(1.6, 0.5, 0.4, 0xf5f5f7, 2.2, 0, 0.8, R.inside);
      const ringBack = new T3.Mesh(new T3.TorusGeometry(0.62, 0.11, 10, 64), mat(0xd8dde3));
      ringBack.position.set(0.4, 1.0, 1.4);
      ringBack.rotation.y = Math.PI / 4;
      R.inside.add(ringBack);
      const ringMat = new T3.MeshStandardMaterial({ color: 0x248a3d, roughness: 0.4 });
      let ring = new T3.Mesh(new T3.TorusGeometry(0.62, 0.13, 10, 64, 0.01), ringMat);
      const ringHolder = new T3.Group();
      ringHolder.position.copy(ringBack.position);
      ringHolder.rotation.y = Math.PI / 4;
      ringHolder.add(ring);
      R.inside.add(ringHolder);
      box(0.08, 0.4, 0.08, 0x8e8e93, 0.4, 0, 1.4, R.inside);
      const line = PEOPLE_COLORS.map((c, i) => {
        const g = person(c, R.inside);
        g.position.set(1.4 + (i % 4) * 0.4, 0, 1.7 + Math.floor(i / 4) * 0.5);
        return g;
      });
      const walkPath = new T3.CatmullRomCurve3([new T3.Vector3(5.2, 0, 3.6), new T3.Vector3(3.8, 0, 3.4), new T3.Vector3(2.4, 0, 3.2), new T3.Vector3(1.4, 0, 3.0)]);
      const walkers = PEOPLE_COLORS.map((c, i) => ({ g: person(c), p: i / PEOPLE_COLORS.length, on: false }));

      // ================= WARRANTY OFFICE: red roof
      const O = B.warranty;
      box(3.2, 0.04, 2.6, 0xeeeae2, 1.6, 0, -4.4, O.group);
      box(3.2, 2.2, 0.1, 0xfafafa, 1.6, 0, -5.65, O.shell, true);
      box(0.1, 2.2, 2.6, 0xfafafa, 0.05, 0, -4.4, O.shell, true);
      box(0.1, 2.2, 2.6, 0xfafafa, 3.15, 0, -4.4, O.shell, true);
      box(3.2, 2.2, 0.08, 0xfafafa, 1.6, 0, -3.14, O.shell, true);
      box(3.4, 0.25, 2.8, 0xc4121a, 1.6, 2.2, -4.4, O.shell, true);
      for (let i = 0; i < 3; i++) box(0.6, 0.6, 0.05, 0x9fc3e6, 0.6 + i * 1.0, 1.1, -3.08, O.shell, true);
      // Inside: the claims of each month as columns.
      const monthBars = Array.from({ length: 12 }, (_, i) => bar(0.18, 0.5, 0x3a3a3c, 0.3 + i * 0.235, -4.6, O.inside));
      box(2.9, 0.05, 0.6, 0xd8d3ca, 1.6, 0, -4.6, O.inside);

      // ================= WARRANTY ROOM (scrap + audits): brown warehouse, a forklift outside
      const M = B.room;
      box(3.4, 0.04, 2.8, 0xe3ddd2, 6.6, 0, -3.6, M.group);
      box(3.4, 1.8, 0.1, 0x9a6b45, 6.6, 0, -4.95, M.shell, true);
      box(0.1, 1.8, 2.8, 0x9a6b45, 4.95, 0, -3.6, M.shell, true);
      box(0.1, 1.8, 2.8, 0x9a6b45, 8.25, 0, -3.6, M.shell, true);
      box(3.4, 1.8, 0.08, 0x9a6b45, 6.6, 0, -2.24, M.shell, true);
      box(3.6, 0.14, 3.0, 0x6f4a2e, 6.6, 1.8, -3.6, M.shell, true);
      box(1.4, 1.1, 0.05, 0xd9d2c5, 6.6, 0, -2.18, M.shell, true);
      // Inside: stacks of crates (the parts scrapped this cycle), shelves, the audit board with its progress bar.
      const crates: THREE.Mesh[] = [];
      for (let i = 0; i < 18; i++) crates.push(box(0.36, 0.3, 0.36, i % 2 ? 0xc9965a : 0xb9864a, 5.4 + (i % 3) * 0.42, Math.floor(i / 6) * 0.3, -4.4 + (Math.floor(i / 3) % 2) * 0.42, M.inside));
      box(0.1, 1.2, 1.2, 0x8e8e93, 8.0, 0, -3.8, M.inside);
      const auditBoard = box(0.06, 0.9, 1.4, 0xffffff, 7.9, 0.4, -3.4, M.inside);
      auditBoard.rotation.y = 0;
      box(0.08, 0.16, 1.2, 0xd8dde3, 7.86, 1.0, -3.4, M.inside);
      const auditFill = box(0.09, 0.16, 1.2, 0x248a3d, 7.85, 1.0, -3.4, M.inside);
      const fork = new T3.Group();
      box(0.5, 0.3, 0.36, 0xf2b705, 0, 0.08, 0, fork);
      box(0.08, 0.6, 0.3, 0x333333, 0.28, 0.08, 0, fork);
      box(0.3, 0.04, 0.26, 0x666666, 0.42, 0.1, 0, fork);
      fork.position.set(6.0, 0, -1.6);
      scene.add(fork);

      // ================= CUSTOMER CARE: coloured booths, people at them
      const Cc = B.care;
      const BOOTH = [0xf27aa6, 0xa78bfa, 0x34c4a0, 0x60a5fa, 0xfdba74];
      BOOTH.forEach((c, i) => {
        const x = -6 + i * 1.3;
        box(1.1, 0.7, 0.9, 0xffffff, x, 0, 5.2, Cc.shell, true);
        const roof = box(1.2, 0.12, 1.1, c, x, 0.95, 5.1, Cc.shell, true);
        roof.rotation.x = -0.2;
        box(0.06, 0.95, 0.06, 0xbbbbbb, x - 0.5, 0, 5.6, Cc.group);
        box(0.06, 0.95, 0.06, 0xbbbbbb, x + 0.5, 0, 5.6, Cc.group);
      });
      const boothPeople = BOOTH.map((_, i) => {
        const g = person(PEOPLE_COLORS[(i + 3) % PEOPLE_COLORS.length], Cc.group);
        g.position.set(-6 + i * 1.3, 0, 6.0);
        return g;
      });
      // Inside: the complaint categories as bars behind the booths.
      const catBars = [0, 1, 2, 3, 4, 5].map((i) => bar(0.6, 0.6, 0x8b5cf6, -6.2 + i * 1.1, 4.1, Cc.inside));

      // ---- traffic round the block
      [[4.4, 2.6, 0], [6.6, 2.6, 2], [7.7, 4.7, 4], [5.5, 4.7, 1], [8.8, 2.6, 5]].forEach(([x, z, c]) => {
        const p = car(CAR_COLORS[c]);
        p.position.set(x + 0.55, 0, z);
        p.rotation.y = Math.PI / 2;
      });
      const loop = new T3.CurvePath<THREE.Vector3>();
      const corners = [new T3.Vector3(-10.15, 0, -6.1), new T3.Vector3(10.15, 0, -6.1), new T3.Vector3(10.15, 0, 7.1), new T3.Vector3(-10.15, 0, 7.1)];
      corners.forEach((c, i) => loop.add(new T3.LineCurve3(c, corners[(i + 1) % 4])));
      const movers = [0, 0.27, 0.52, 0.78].map((p, i) => ({ car: car(CAR_COLORS[i]), p, speed: 0.018 + i * 0.002 }));

      // ---- the numbers drive the town (target heights; the loop grows the bars to them)
      const targets = new Map<THREE.Mesh, number>();
      const anchorOf: Record<string, THREE.Vector3> = {};
      for (const b of BOARDS) anchorOf[b.id] = new T3.Vector3(...b.at);
      const update = (t: Totals, sc: number, d: TownDetails | null) => {
        const s = statusOf(t.vsPlan);
        // Workshop bays: about one car per 15 open job cards per branch.
        const perBranch = t.openWips / Math.max(1, sc);
        const cars = t.openWips === 0 ? 0 : Math.max(1, Math.min(4, Math.round(perBranch / 15)));
        bayCars.forEach((c, i) => (c.visible = i < cars));
        lift.visible = cars > 1;
        // Reception: walkers outside (customers today), the waiting line inside, the sales ring.
        const walking = t.queueToday === 0 ? 0 : Math.max(1, Math.min(walkers.length, Math.round(t.queueToday / Math.max(1, sc) / 3)));
        walkers.forEach((w, i) => ((w.on = i < walking), (w.g.visible = w.on)));
        line.forEach((g, i) => (g.visible = i < Math.min(line.length, t.queueWaiting)));
        ringHolder.remove(ring);
        ring.geometry.dispose();
        ring = new T3.Mesh(new T3.TorusGeometry(0.62, 0.13, 10, 64, Math.max(0.01, Math.PI * 2 * Math.min(1, t.vsPlan ?? 0))), ringMat);
        ring.rotation.z = Math.PI / 2;
        ringHolder.add(ring);
        ringMat.color.set(s ? STATUS[s].c : "#8e8e93");
        // Complaint booths: one person per open complaint (up to five).
        boothPeople.forEach((g, i) => (g.visible = i < Math.min(BOOTH.length, t.complaintsOpen)));
        if (!d) return;
        const maxAge = Math.max(1, ...d.workshop.ageing);
        ageBars.forEach((m, i) => targets.set(m, 0.15 + (d.workshop.ageing[i] / maxAge) * 2.2));
        const months = d.warranty.months.slice(-12);
        const maxM = Math.max(1, ...months.map((x) => x.n));
        monthBars.forEach((m, i) => {
          const x = months[i];
          m.visible = !!x;
          targets.set(m, x ? 0.1 + (x.n / maxM) * 1.9 : 0.001);
        });
        const cats = d.complaints.categories.slice(0, 6);
        const maxC = Math.max(1, ...cats.map((x) => x.n));
        catBars.forEach((m, i) => {
          m.visible = !!cats[i];
          targets.set(m, cats[i] ? 0.1 + (cats[i].n / maxC) * 1.5 : 0.001);
        });
        // Warranty room: one crate per few parts scrapped this cycle per branch; the audit bar fills with the audit.
        const scr = d.room.scrappedThisCycle / Math.max(1, sc);
        const crateN = scr === 0 ? 0 : Math.max(1, Math.min(crates.length, Math.ceil(scr / 12)));
        crates.forEach((c, i) => (c.visible = i < crateN));
        const frac = d.audit.assignments ? d.audit.done / d.audit.assignments : 0;
        auditFill.scale.z = Math.max(0.01, frac);
        auditFill.position.z = -3.4 - (1.2 * (1 - frac)) / 2;
        (auditFill.material as THREE.MeshStandardMaterial).color.set(frac >= 1 ? GOOD : WARN);
      };
      update(latest.current.totals, latest.current.scale, latest.current.details);

      // ---- going inside a building: fly there, fade its walls, grow its figures
      let focused: Dept | null = null;
      const aim = { target: HOME.clone(), zoom: 1, flying: false };
      const right = new T3.Vector3();
      const focus = (dpt: Dept | null) => {
        focused = dpt;
        for (const k of DEPTS) {
          const b = B[k];
          if (k === dpt) {
            b.inside.visible = true;
            b.inside.traverse((o) => targets.has(o as THREE.Mesh) && ((o as THREE.Mesh).scale.y = 0.001));
          }
        }
        const r = el.getBoundingClientRect();
        if (dpt) {
          const zoom = r.width < 640 ? 1.7 : 1.9;
          aim.zoom = zoom;
          // Keep the building clear of the details panel on the right (about 27rem wide on a computer).
          right.setFromMatrixColumn(camera.matrixWorld, 0);
          const pxPerUnit = (r.width / (camera.right - camera.left)) * zoom;
          const shift = r.width >= 900 ? 215 / pxPerUnit : 0;
          aim.target.set(...BUILDING[dpt].center).addScaledVector(right, shift);
        } else {
          aim.zoom = 1;
          aim.target.copy(HOME);
        }
        aim.flying = true;
      };
      api.current = { update, focus };

      // Click a building: go inside. Hover: a hand cursor.
      const ray = new T3.Raycaster();
      const ptr = new T3.Vector2();
      const groups = DEPTS.map((k) => B[k].group);
      const deptAt = (e: PointerEvent): Dept | null => {
        const r = renderer.domElement.getBoundingClientRect();
        ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ptr, camera);
        for (const h of ray.intersectObjects(groups, true)) {
          let o: THREE.Object3D | null = h.object;
          while (o && !o.userData.dept) o = o.parent;
          if (o) return o.userData.dept as Dept;
        }
        return null;
      };
      let downAt = { x: 0, y: 0 };
      const onDown = (e: PointerEvent) => (downAt = { x: e.clientX, y: e.clientY });
      const onUp = (e: PointerEvent) => {
        if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return; // a drag
        const d = deptAt(e);
        if (d) openRef.current(d);
      };
      const onMove = (e: PointerEvent) => (renderer.domElement.style.cursor = deptAt(e) ? "pointer" : "grab");
      renderer.domElement.addEventListener("pointerdown", onDown);
      renderer.domElement.addEventListener("pointerup", onUp);
      renderer.domElement.addEventListener("pointermove", onMove);
      controls.addEventListener("start", () => (aim.flying = false));

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
      if (latest.current.open) focus(latest.current.open);

      const clock = new T3.Clock();
      const v = new T3.Vector3();
      const place = (node: HTMLElement | null | undefined, p: THREE.Vector3, r: DOMRect, extra = "") => {
        if (!node) return;
        v.copy(p).project(camera);
        node.style.transform = `translate(${((v.x + 1) / 2) * r.width}px, ${((1 - v.y) / 2) * r.height}px) ${extra}`;
      };
      let frame = 0;
      const tick = () => {
        frame = requestAnimationFrame(tick);
        const dt = Math.min(0.05, clock.getDelta());
        const time = clock.elapsedTime;
        const k = reduce ? 1 : 1 - Math.pow(0.002, dt); // smooth step towards the aim
        // Camera flight.
        if (aim.flying) {
          controls.target.lerp(aim.target, k);
          camera.zoom += (aim.zoom - camera.zoom) * k;
          camera.updateProjectionMatrix();
          if (controls.target.distanceTo(aim.target) < 0.01 && Math.abs(camera.zoom - aim.zoom) < 0.005) aim.flying = false;
        }
        // Walls fade on the open building, back elsewhere; its figures grow.
        for (const dpt of DEPTS) {
          const b = B[dpt];
          const want = dpt === focused ? 0.1 : 1;
          if (Math.abs(b.fade - want) > 0.002) {
            b.fade += (want - b.fade) * k;
            b.shell.traverse((o) => {
              const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
              if (m) {
                m.opacity = b.fade;
                m.depthWrite = b.fade > 0.95;
              }
            });
            if (dpt !== focused && b.fade > 0.97) b.inside.visible = false;
          }
        }
        for (const [m, h] of targets) m.scale.y += (h - m.scale.y) * (reduce ? 1 : k * 0.6);
        // Bars carry their number boards on top.
        ageBars.forEach((m, i) => anchorOf[`w_bar${i}`].set(m.position.x, m.scale.y + 0.35, m.position.z));
        anchorOf.o_last.set(monthBars.filter((m) => m.visible).at(-1)?.position.x ?? 0, (monthBars.filter((m) => m.visible).at(-1)?.scale.y ?? 0) + 0.35, -4.6);
        catBars.forEach((m, i) => anchorOf[`c_bar${i}`].set(m.position.x, m.scale.y + 0.35, m.position.z));

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
          const f = (Math.sin(time * 0.6) + 1) / 2;
          fork.position.x = 5.4 + f * 2.4;
          fork.rotation.y = Math.cos(time * 0.6) > 0 ? Math.PI : 0;
          ringHolder.rotation.y = Math.PI / 4 + Math.sin(time * 0.5) * 0.15;
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

        // Cards follow their buildings (hidden while inside one); boards stand in the open building.
        const r = el.getBoundingClientRect();
        for (const id of DEPTS) {
          const c = cards.current[id];
          const dot = dots.current[id];
          const p = new T3.Vector3(...BUILDING[id].card);
          place(c, p, r, BUILDING[id].side);
          place(dot, p, r, "translate(-4px, -4px)");
          const show = focused ? "hidden" : "visible";
          if (c) c.style.visibility = show;
          if (dot) dot.style.visibility = show;
        }
        for (const b of BOARDS) {
          const node = boards.current[b.id];
          if (!node) continue;
          const on = focused === b.dept && B[b.dept].fade < 0.6 && node.dataset.empty !== "1";
          node.style.visibility = on ? "visible" : "hidden";
          node.style.opacity = on ? "1" : "0";
          if (on) place(node, anchorOf[b.id], r, "translate(-50%, -100%)");
        }
      };
      tick();

      cleanup = () => {
        cancelAnimationFrame(frame);
        ro.disconnect();
        renderer.domElement.removeEventListener("pointerdown", onDown);
        renderer.domElement.removeEventListener("pointerup", onUp);
        renderer.domElement.removeEventListener("pointermove", onMove);
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
  const setEl = (id: Dept, el: HTMLDivElement | null) => {
    cards.current[id] = el;
  };
  const d = details;
  const rows: Record<Dept, Row[]> = {
    workshop: [
      { label: "Open WIPs", value: money(totals.openWips) },
      d
        ? { label: "Past promised date", value: money(d.workshop.overdue), color: d.workshop.overdue > 0 ? BAD : GOOD }
        : { label: "Over 30 days", value: money(totals.oldWips), color: totals.oldWips > 0 ? BAD : GOOD },
      d ? { label: "Avg. age", value: d.workshop.avgAge == null ? "—" : `${d.workshop.avgAge} days` } : { label: "Value", value: `SAR ${short(totals.openWipValue)}` },
    ],
    reception: [
      { label: "Sold", value: totals.sold == null ? "—" : `SAR ${short(totals.sold)}` },
      { label: "vs plan", value: s ? `${pct(totals.vsPlan)} ${STATUS[s].t}` : "—", color: s ? STATUS[s].c : undefined },
      { label: "Customers today", value: money(totals.queueToday) },
    ],
    warranty: [
      { label: "Claims this year", value: money(d?.warranty.claims ?? totals.warrantyClaims) },
      ...(d ? [{ label: "Settled", value: pct(d.warranty.claims ? d.warranty.settled / d.warranty.claims : null) }] : []),
      { label: "Tech. claims waiting", value: money(totals.techWaiting), color: totals.techWaiting > 0 ? WARN : GOOD },
    ],
    room: d
      ? [
          { label: "Scrapped this cycle", value: money(d.room.scrappedThisCycle) },
          { label: "Still to scrap", value: money(d.room.flaggedParts), color: d.room.flaggedParts > 0 ? WARN : GOOD },
          { label: "Self-audit", value: `${d.audit.done} / ${d.audit.assignments} · ${d.audit.score ?? "—"}%`, color: d.audit.assignments && d.audit.done < d.audit.assignments ? WARN : GOOD },
        ]
      : [{ label: "Details", value: "—" }],
    care: [
      { label: "This year", value: money(totals.complaints) },
      { label: "Still open", value: money(totals.complaintsOpen), color: totals.complaintsOpen > 0 ? BAD : GOOD },
    ],
  };
  const list = DEPTS.map((id) => ({ id, icon: DEPT_TITLE[id].icon, title: DEPT_TITLE[id].title, rows: rows[id] }));
  const content = boardContent(totals, details);
  return (
    <>
      <div className="relative h-[clamp(360px,72vh,760px)] w-full overflow-hidden rounded-2xl bg-[#efe9df] ring-1 ring-black/[0.06] max-sm:h-[340px]">
        <div ref={host} className="absolute inset-0" />
        {/* Number boards inside the open building. */}
        {BOARDS.map((b) => {
          const c = content[b.id];
          return (
            <div
              key={b.id}
              ref={(el) => {
                boards.current[b.id] = el;
              }}
              data-empty={c ? "0" : "1"}
              className={`pointer-events-none absolute top-0 left-0 rounded-lg text-center whitespace-nowrap transition-opacity duration-500 ${b.small ? "bg-white/90 px-1.5 py-0.5 text-[10px] shadow" : "bg-[#1d1d1f]/90 px-2.5 py-1.5 text-white shadow-xl"}`}
              style={{ visibility: "hidden", opacity: 0 }}
            >
              {c && (
                <>
                  <div className={b.small ? "text-[#6e6e73]" : "text-[10px] font-semibold tracking-wide text-white/70 uppercase"}>{c.title}</div>
                  <div className={`font-bold tabular-nums ${b.small ? "text-[12px] text-[#1d1d1f]" : "text-[18px] leading-tight"}`} style={c.color && !b.small ? { color: c.color === GOOD ? "#5bd27a" : c.color === WARN ? "#ffb35c" : c.color === BAD ? "#ff6b6b" : c.color } : undefined}>
                    {c.value}
                  </div>
                  {c.note && !b.small && <div className="text-[10px] text-white/70">{c.note}</div>}
                </>
              )}
            </div>
          );
        })}
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
            <Card key={c.id} id={c.id} setEl={setEl} icon={c.icon} title={c.title} rows={c.rows} active={open === c.id} onOpen={onOpen} />
          ))}
        </div>
        {open && (
          <button type="button" onClick={() => onOpen(null)} className="absolute top-3 left-3 rounded-full bg-white/95 px-3.5 py-1.5 text-[13px] font-semibold text-[#1d1d1f] shadow-md ring-1 ring-black/[0.08] hover:bg-white">
            ← Back to the service centre
          </button>
        )}
        {open && <div className="absolute inset-y-3 right-3 w-[min(26rem,calc(100%-1.5rem))] overflow-hidden rounded-2xl bg-white/[0.97] shadow-2xl ring-1 ring-black/[0.08] backdrop-blur max-sm:hidden">{panel}</div>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:hidden">
        {list.map((c) => (
          <button key={c.id} type="button" onClick={() => onOpen(c.id)} className={`rounded-xl bg-white px-3 py-2 text-left text-[12px] shadow-sm ring-1 ${open === c.id ? "ring-2 ring-[#1d1d1f]" : "ring-black/[0.06]"}`}>
            <div className="mb-1 flex items-center gap-1.5 font-bold">
              <span aria-hidden="true">{c.icon}</span>
              {c.title}
            </div>
            {c.rows.map((x) => (
              <div key={x.label} className="flex justify-between gap-2 leading-5">
                <span className="text-[#6e6e73]">{x.label}</span>
                <span className="font-semibold tabular-nums" style={x.color ? { color: x.color } : undefined}>
                  {x.value}
                </span>
              </div>
            ))}
          </button>
        ))}
      </div>
    </>
  );
}
