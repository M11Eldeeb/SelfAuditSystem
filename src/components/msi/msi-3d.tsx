"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import { getBusinessView, type BusinessBranch } from "@/app/admin/msi/actions";
import { CarLoaderCard } from "@/components/spinner";
import { money, pct } from "@/components/msi/msi-ui";
import { short } from "@/components/msi/msi-overview";
import { ServiceTown } from "@/components/msi/msi-town";

// The whole business in 3D (three.js): every branch stands where it is in the Kingdom; the height of its tower is the
// figure chosen above, its colour says whether that is good (sales against plan) or how much needs attention (counts).
// Drag to turn, scroll to zoom, click a branch to fly to it. The same figures are in the table under the picture.

type MetricId = "sold" | "vsPlan" | "forecastVsTarget" | "openWips" | "oldWips" | "warrantyClaims" | "complaintsOpen" | "techWaiting";
type Kind = "status" | "attention" | "volume";
const METRICS: { id: MetricId; label: string; kind: Kind; fmt: (v: number) => string; help: string }[] = [
  { id: "sold", label: "Sales this month", kind: "status", fmt: (v) => `SAR ${short(v)}`, help: "Height: sold so far this month. Colour: against the plan for today." },
  { id: "vsPlan", label: "Sales vs plan", kind: "status", fmt: (v) => pct(v), help: "Height and colour: sold against the plan for today (100% = on plan)." },
  { id: "forecastVsTarget", label: "Month-end forecast", kind: "status", fmt: (v) => pct(v), help: "Height and colour: where the month ends if the pace holds, against the month target." },
  { id: "openWips", label: "Open WIPs", kind: "volume", fmt: (v) => String(Math.round(v)), help: "Height: job cards still open in the workshop." },
  { id: "oldWips", label: "WIPs over 30 days", kind: "attention", fmt: (v) => String(Math.round(v)), help: "Height: job cards open for more than 30 days. Redder = more to chase." },
  { id: "warrantyClaims", label: "Warranty claims (year)", kind: "volume", fmt: (v) => String(Math.round(v)), help: "Height: warranty claims created this year." },
  { id: "complaintsOpen", label: "Open complaints", kind: "attention", fmt: (v) => String(Math.round(v)), help: "Height: customer complaints still in progress. Redder = more to close." },
  { id: "techWaiting", label: "Technician claims waiting", kind: "attention", fmt: (v) => String(Math.round(v)), help: "Height: technician claims waiting for the warranty admin's review." },
];

/** Where each branch stands (scene units from longitude / latitude; the three Jeddah and three Riyadh branches spread out). */
const PLACE: Record<string, [number, number]> = {
  HER: [-8.6, 3.0],
  MRB: [-7.2, 3.9],
  NKH: [-8.9, 4.7],
  MAD: [-7.8, -0.8],
  QSM: [-0.9, -3.8],
  RNQ: [3.4, -2.2],
  RSS: [2.5, -0.7],
  RKR: [4.4, -0.6],
  DMM: [9.0, -3.9],
  ABH: [-3.2, 9.0],
  JZN: [-3.2, 11.4],
};
const CITY: { label: string; at: [number, number] }[] = [
  { label: "Jeddah", at: [-8.2, 5.9] },
  { label: "Riyadh", at: [3.4, 0.7] },
];

const STATUS_HEX = { good: 0x248a3d, warn: 0xb45309, bad: 0xd70015, none: 0x6e6e73 };
const statusOf = (v: number | null) => (v == null ? "none" : v >= 1 ? "good" : v >= 0.9 ? "warn" : "bad");
const STATUS_WORD = { good: "✓ On track", warn: "! Close", bad: "↓ Behind", none: "no figure" };

const valueOf = (b: BusinessBranch, m: MetricId): number | null => b[m];

export function Business3DTab({ reportDate }: { reportDate: string }) {
  const [data, setData] = useState<{ branches?: BusinessBranch[]; error?: string } | null>(null);
  const [metric, setMetric] = useState<MetricId>("sold");
  const [picked, setPicked] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [view, setView] = useState<"town" | "map">("town");
  useEffect(() => {
    let live = true;
    getBusinessView(reportDate).then(
      (r) => live && setData(r),
      () => live && setData({ error: "Could not load the figures." }),
    );
    return () => {
      live = false;
    };
  }, [reportDate]);

  const branches = useMemo(() => (data?.branches ?? []).filter((b) => PLACE[b.code]), [data]);
  const m = METRICS.find((x) => x.id === metric)!;
  const focus = branches.find((b) => b.code === (hovered ?? picked)) ?? null;

  if (!data) return <CarLoaderCard label="Building the 3D view…" />;
  if (data.error) return <p className="rounded-xl bg-[#f5f5f7] px-4 py-8 text-center text-sm text-[#6e6e73]">{data.error}</p>;

  const views = (
    <div className="inline-flex gap-0.5 rounded-[12px] bg-[#e9e9ec] p-[3px]" role="group" aria-label="View">
      {(
        [
          ["town", "Service centre"],
          ["map", "Branches on the map"],
        ] as const
      ).map(([id, label]) => (
        <button key={id} type="button" onClick={() => setView(id)} aria-pressed={view === id} className={`rounded-[9px] px-3.5 py-1.5 text-[13px] font-semibold ${view === id ? "bg-white text-[#1d1d1f] shadow-sm" : "text-neutral-600 hover:bg-white/50"}`}>
          {label}
        </button>
      ))}
    </div>
  );
  if (view === "town")
    return (
      <div className="space-y-4">
        {views}
        <ServiceTown branches={branches} />
      </div>
    );

  return (
    <div className="space-y-4">
      {views}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="What the towers show">
        {METRICS.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setMetric(x.id)}
            aria-pressed={x.id === metric}
            className={`rounded-full px-3 py-1 text-[13px] font-semibold ring-1 transition ${x.id === metric ? "bg-[#1d1d1f] text-white ring-[#1d1d1f]" : "bg-white text-[#1d1d1f] ring-black/10 hover:bg-[#f5f5f7]"}`}
          >
            {x.label}
          </button>
        ))}
      </div>

      <div className="relative overflow-hidden rounded-2xl bg-[#0d0f14] ring-1 ring-black/10">
        <Scene branches={branches} metric={metric} picked={picked} onPick={setPicked} onHover={setHovered} />
        <div className="pointer-events-none absolute top-3 left-3 max-w-sm rounded-xl bg-white/10 px-3 py-2 text-xs text-white/85 backdrop-blur">
          <div className="font-semibold text-white">{m.label}</div>
          <div>{m.help}</div>
          <Legend kind={m.kind} />
          <div className="mt-1 text-white/55">Drag to turn · scroll to zoom · click a branch</div>
        </div>
        {focus && <BranchCard b={focus} metric={metric} onClose={picked ? () => setPicked(null) : undefined} />}
      </div>

      <div>
        <button type="button" onClick={() => setShowTable((v) => !v)} className="text-sm font-semibold text-[#1d1d1f] underline underline-offset-2">
          {showTable ? "Hide the table" : "Show the figures as a table"}
        </button>
        {showTable && <Table branches={branches} />}
      </div>
    </div>
  );
}

function Legend({ kind }: { kind: Kind }) {
  if (kind === "status")
    return (
      <div className="mt-1.5 flex flex-wrap gap-2">
        {(["good", "warn", "bad"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: `#${STATUS_HEX[s].toString(16).padStart(6, "0")}` }} />
            {STATUS_WORD[s]}
          </span>
        ))}
      </div>
    );
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <span>fewer</span>
      <span className="h-2 w-24 rounded-full" style={{ background: kind === "attention" ? "linear-gradient(90deg,#5a3a3c,#ff3b45)" : "linear-gradient(90deg,#3d4756,#9fb4d0)" }} />
      <span>more</span>
    </div>
  );
}

function BranchCard({ b, metric, onClose }: { b: BusinessBranch; metric: MetricId; onClose?: () => void }) {
  const s = statusOf(b.vsPlan);
  const row = (id: MetricId | null, label: string, value: string) => (
    <div className={`flex justify-between gap-4 ${id === metric ? "font-bold text-white" : ""}`}>
      <span className="text-white/70">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
  return (
    <div className="absolute top-3 right-3 w-72 rounded-xl bg-[#1d1d1f]/90 p-3 text-xs text-white shadow-xl ring-1 ring-white/10 backdrop-blur">
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-bold">{b.name}</div>
          <div className="text-white/60">{b.code}</div>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="pointer-events-auto rounded px-1.5 text-white/70 hover:bg-white/10" aria-label="Close">
            ✕
          </button>
        )}
      </div>
      <div className="space-y-0.5">
        {row("sold", "Sold this month", b.sold == null ? "—" : `SAR ${money(b.sold)}`)}
        {row("vsPlan", "vs plan for today", b.vsPlan == null ? "—" : `${pct(b.vsPlan)} ${STATUS_WORD[s]}`)}
        {row("forecastVsTarget", "Month-end forecast", b.forecastVsTarget == null ? "—" : `${pct(b.forecastVsTarget)} of target`)}
        {row("openWips", "Open WIPs", `${b.openWips} · SAR ${short(b.openWipValue)}`)}
        {row("oldWips", "WIPs over 30 days", String(b.oldWips))}
        {row("warrantyClaims", "Warranty claims this year", String(b.warrantyClaims))}
        {row("complaintsOpen", "Complaints this year / open", `${b.complaints} / ${b.complaintsOpen}`)}
        {row("techWaiting", "Technician claims waiting", String(b.techWaiting))}
      </div>
    </div>
  );
}

function Table({ branches }: { branches: BusinessBranch[] }) {
  const th = "px-3 py-2 text-left text-[11px] font-semibold tracking-wide text-[#6e6e73] uppercase whitespace-nowrap";
  const td = "px-3 py-2 whitespace-nowrap tabular-nums";
  return (
    <div className="mt-2 overflow-x-auto rounded-xl ring-1 ring-[#ececec]">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="bg-[#f5f5f7]">
          <tr>
            {["Branch", "Sold", "vs plan", "Forecast", "Open WIPs", "Over 30 days", "Warranty claims", "Complaints / open", "Tech. claims waiting"].map((h) => (
              <th key={h} className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#ececec]">
          {branches.map((b) => (
            <tr key={b.code}>
              <td className={`${td} font-medium`}>{b.name}</td>
              <td className={td}>{b.sold == null ? "—" : money(b.sold)}</td>
              <td className={td}>{b.vsPlan == null ? "—" : `${pct(b.vsPlan)} ${STATUS_WORD[statusOf(b.vsPlan)]}`}</td>
              <td className={td}>{pct(b.forecastVsTarget)}</td>
              <td className={td}>{b.openWips}</td>
              <td className={td}>{b.oldWips}</td>
              <td className={td}>{b.warrantyClaims}</td>
              <td className={td}>
                {b.complaints} / {b.complaintsOpen}
              </td>
              <td className={td}>{b.techWaiting}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- the three.js scene ----------

function Scene({ branches, metric, picked, onPick, onHover }: { branches: BusinessBranch[]; metric: MetricId; picked: string | null; onPick: (c: string | null) => void; onHover: (c: string | null) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  // The scene's handle: lets later renders change the metric / focus without building the scene again.
  const api = useRef<{ setMetric: (m: MetricId) => void; focus: (code: string | null) => void } | null>(null);
  // The latest metric / focus for the scene (also read once when it has just been built).
  const metricRef = useRef(metric);
  const pickedRef = useRef(picked);
  const cb = useRef({ onPick, onHover });
  useEffect(() => {
    cb.current = { onPick, onHover };
  });

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      const el = host.current;
      const labelHost = labels.current;
      if (disposed || !el || !labelHost) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0d0f14);
      scene.fog = new THREE.Fog(0x0d0f14, 32, 60);
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
      camera.position.set(-2, 17, 21);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.target.set(-0.5, 0, 2.5);
      controls.maxPolarAngle = Math.PI * 0.46;
      controls.minDistance = 6;
      controls.maxDistance = 40;
      controls.autoRotate = !reduce;
      controls.autoRotateSpeed = 0.35;
      controls.addEventListener("start", () => (controls.autoRotate = false));

      scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x15171c, 0.9));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6);
      sun.position.set(-10, 22, 12);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18 });
      scene.add(sun);

      // The ground: a round platform with a soft grid.
      const ground = new THREE.Mesh(new THREE.CircleGeometry(19, 96), new THREE.MeshStandardMaterial({ color: 0x161a22, roughness: 0.95 }));
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);
      const grid = new THREE.GridHelper(38, 38, 0x2a3140, 0x1d222c);
      (grid.material as THREE.Material).transparent = true;
      (grid.material as THREE.Material).opacity = 0.55;
      grid.position.y = 0.01;
      scene.add(grid);
      const rim = new THREE.Mesh(new THREE.RingGeometry(18.8, 19, 128), new THREE.MeshBasicMaterial({ color: 0x3a4150, side: THREE.DoubleSide }));
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = 0.02;
      scene.add(rim);

      type Tower = { code: string; mesh: THREE.Mesh; base: THREE.Mesh; mat: THREE.MeshStandardMaterial; target: number; color: THREE.Color; label: HTMLDivElement; value: HTMLSpanElement };
      const towers: Tower[] = [];
      const boxGeo = new THREE.BoxGeometry(0.9, 1, 0.9);
      boxGeo.translate(0, 0.5, 0);
      const baseGeo = new THREE.CylinderGeometry(0.85, 0.85, 0.06, 40);
      for (const b of branches) {
        const [x, z] = PLACE[b.code];
        const mat = new THREE.MeshStandardMaterial({ color: 0x6e6e73, roughness: 0.35, metalness: 0.15, emissive: 0x000000 });
        const mesh = new THREE.Mesh(boxGeo, mat);
        mesh.position.set(x, 0.06, z);
        mesh.scale.y = 0.01;
        mesh.castShadow = true;
        mesh.userData.code = b.code;
        const base = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({ color: 0x2b313d, roughness: 0.8 }));
        base.position.set(x, 0.03, z);
        base.receiveShadow = true;
        base.userData.code = b.code;
        scene.add(mesh, base);
        const label = document.createElement("div");
        label.className = "absolute -translate-x-1/2 -translate-y-full cursor-pointer select-none rounded-md bg-black/55 px-1.5 py-0.5 text-center text-[11px] leading-tight text-white ring-1 ring-white/10 backdrop-blur-sm";
        label.innerHTML = `<div class="font-bold">${b.code}</div>`;
        const value = document.createElement("span");
        value.className = "tabular-nums text-white/80";
        label.appendChild(value);
        label.addEventListener("click", () => cb.current.onPick(b.code));
        labelHost.appendChild(label);
        towers.push({ code: b.code, mesh, base, mat, target: 0.01, color: new THREE.Color(0x6e6e73), label, value });
      }
      const cityLabels = CITY.map((c) => {
        const d = document.createElement("div");
        d.className = "absolute -translate-x-1/2 text-[10px] font-semibold tracking-[0.2em] text-white/35 uppercase";
        d.textContent = c.label;
        labelHost.appendChild(d);
        return { d, pos: new THREE.Vector3(c.at[0], 0, c.at[1]) };
      });

      const setMetric = (mid: MetricId) => {
        const def = METRICS.find((x) => x.id === mid)!;
        const vals = branches.map((b) => valueOf(b, mid));
        const max = Math.max(...vals.map((v) => v ?? 0), def.kind === "status" && mid !== "sold" ? 1.2 : 1e-9);
        towers.forEach((t, i) => {
          const b = branches[i];
          const v = vals[i];
          t.target = v == null || max <= 0 ? 0.05 : Math.max(0.08, (v / max) * 7);
          const f = v == null || max <= 0 ? 0 : v / max;
          if (def.kind === "status") t.color.setHex(STATUS_HEX[statusOf(mid === "sold" ? b.vsPlan : v)]);
          else if (def.kind === "attention") t.color.setRGB(0.35 + 0.65 * f, 0.23 - 0.0 * f, 0.24 - 0.0 * f).lerp(new THREE.Color(0xff3b45), f * 0.6);
          else t.color.setRGB(0.24 + 0.38 * f, 0.28 + 0.43 * f, 0.34 + 0.48 * f);
          t.value.textContent = v == null ? "—" : def.fmt(v);
        });
      };

      // Fly the camera's aim to a branch (or back to the whole map).
      let aimTo: THREE.Vector3 | null = null;
      let distTo: number | null = null;
      const focus = (code: string | null) => {
        const t = towers.find((x) => x.code === code);
        aimTo = t ? new THREE.Vector3(t.mesh.position.x, t.target * 0.45, t.mesh.position.z) : new THREE.Vector3(-0.5, 0, 2.5);
        distTo = t ? 11 : 27;
        controls.autoRotate = false;
      };
      api.current = { setMetric, focus };

      // Hover / click: which tower is under the pointer.
      const ray = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      let over: string | null = null;
      let downAt = { x: 0, y: 0 };
      const hit = (e: PointerEvent) => {
        const r = renderer.domElement.getBoundingClientRect();
        pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(pointer, camera);
        const h = ray.intersectObjects(towers.flatMap((t) => [t.mesh, t.base]))[0];
        return (h?.object.userData.code as string | undefined) ?? null;
      };
      const onMove = (e: PointerEvent) => {
        const code = hit(e);
        if (code !== over) {
          over = code;
          renderer.domElement.style.cursor = code ? "pointer" : "grab";
          cb.current.onHover(code);
        }
      };
      const onDown = (e: PointerEvent) => (downAt = { x: e.clientX, y: e.clientY });
      const onUp = (e: PointerEvent) => {
        if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return; // a drag, not a click
        cb.current.onPick(hit(e));
      };
      const onLeave = () => {
        over = null;
        cb.current.onHover(null);
      };
      renderer.domElement.addEventListener("pointermove", onMove);
      renderer.domElement.addEventListener("pointerdown", onDown);
      renderer.domElement.addEventListener("pointerup", onUp);
      renderer.domElement.addEventListener("pointerleave", onLeave);

      const size = () => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      size();
      const ro = new ResizeObserver(size);
      ro.observe(el);

      const v = new THREE.Vector3();
      let frame = 0;
      const tick = () => {
        frame = requestAnimationFrame(tick);
        for (const t of towers) {
          t.mesh.scale.y += (t.target - t.mesh.scale.y) * (reduce ? 1 : 0.08);
          t.mat.color.lerp(t.color, reduce ? 1 : 0.1);
          const lit = t.code === over;
          t.mat.emissive.setHex(lit ? 0x333333 : 0x000000);
          v.set(t.mesh.position.x, t.mesh.position.y + t.mesh.scale.y + 0.25, t.mesh.position.z).project(camera);
          const r = el.getBoundingClientRect();
          t.label.style.left = `${((v.x + 1) / 2) * r.width}px`;
          t.label.style.top = `${((1 - v.y) / 2) * r.height}px`;
          t.label.style.display = v.z < 1 ? "" : "none";
          t.label.style.outline = lit ? "2px solid rgba(255,255,255,0.8)" : "";
        }
        for (const c of cityLabels) {
          v.copy(c.pos).project(camera);
          const r = el.getBoundingClientRect();
          c.d.style.left = `${((v.x + 1) / 2) * r.width}px`;
          c.d.style.top = `${((1 - v.y) / 2) * r.height}px`;
        }
        if (aimTo) {
          controls.target.lerp(aimTo, 0.08);
          if (distTo != null) {
            const dir = camera.position.clone().sub(controls.target);
            dir.setLength(dir.length() + (distTo - dir.length()) * 0.08);
            camera.position.copy(controls.target).add(dir);
          }
          if (controls.target.distanceTo(aimTo) < 0.01) aimTo = null;
        }
        controls.update();
        renderer.render(scene, camera);
      };
      tick();

      cleanup = () => {
        cancelAnimationFrame(frame);
        ro.disconnect();
        controls.dispose();
        renderer.domElement.removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("pointerdown", onDown);
        renderer.domElement.removeEventListener("pointerup", onUp);
        renderer.domElement.removeEventListener("pointerleave", onLeave);
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          mesh.geometry?.dispose();
          const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
          (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
        });
        renderer.dispose();
        renderer.domElement.remove();
        labelHost.replaceChildren();
        api.current = null;
      };
      setMetric(metricRef.current);
      focus(pickedRef.current);
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, [branches]);

  useEffect(() => {
    metricRef.current = metric;
    api.current?.setMetric(metric);
  }, [metric]);
  useEffect(() => {
    pickedRef.current = picked;
    api.current?.focus(picked);
  }, [picked]);

  return (
    <div className="relative h-[clamp(420px,68vh,720px)] w-full">
      <div ref={host} className="absolute inset-0" />
      <div ref={labels} className="pointer-events-none absolute inset-0 [&>div]:pointer-events-auto" />
    </div>
  );
}
