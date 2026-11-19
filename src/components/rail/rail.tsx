"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { KeyIcon, NavIcon } from "@/components/nav-icons";
import { DEPT_LABEL, buildRail, railActiveKey, type RailDept, type RailEntry, type RailKpi, type RailLink } from "@/lib/rail";

/**
 * The desktop navigation (1280 px and up): a black rounded icon rail, like the Sub-Dealer Warranty Desk's. One button per
 * department (or page); a department opens a panel beside the rail with its pages and dashboards. The white marker is one
 * element that slides to the active button, and the rail lives in the area's layout, so it stays on screen (and the marker
 * keeps its place) while the page changes. Below 1280 px NavBar shows its drawer instead.
 */
export function Rail({ links, kpis, activeHref }: { links: RailLink[]; kpis: RailKpi[]; activeHref: string | undefined }) {
  const router = useRouter();
  const pathname = usePathname();
  const model = useMemo(() => buildRail(links, kpis), [links, kpis]);
  // The dashboard page with no ?tab= is its Overview; its KPI entry carries the marker.
  const pageHref = useMemo(() => {
    if (!activeHref) return activeHref;
    if (railActiveKey(model, activeHref)) return activeHref;
    const path = activeHref.split("?")[0];
    const same = kpis.filter((k) => k.href.split("?")[0] === path);
    return (same.find((k) => k.href.includes("tab=overview")) ?? same[0])?.href ?? activeHref;
  }, [model, kpis, activeHref]);
  const activeKey = railActiveKey(model, pageHref);

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [panelTop, setPanelTop] = useState(12);
  const asideRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const prefetched = useRef(new Set<string>());

  // The marker: measured from the active button, so it can slide. Until it is first placed the active button paints its own white.
  const [marker, setMarker] = useState<{ y: number } | null>(null);
  const [placed, setPlaced] = useState(false);
  const [glide, setGlide] = useState(false);
  useLayoutEffect(() => {
    const el = activeKey ? itemRefs.current.get(activeKey) : null;
    // Measured against the rail body (the marker's positioned parent), so top and bottom buttons share one coordinate system.
    const body = bodyRef.current;
    setMarker(el && body ? { y: el.getBoundingClientRect().top - body.getBoundingClientRect().top } : null);
    setPlaced(true);
  }, [activeKey]);
  useEffect(() => {
    const id = requestAnimationFrame(() => setGlide(true)); // no slide on the very first placement
    return () => cancelAnimationFrame(id);
  }, []);

  // The panel closes when the page changes.
  const [lastPath, setLastPath] = useState(pathname + (activeHref ?? ""));
  if (pathname + (activeHref ?? "") !== lastPath) {
    setLastPath(pathname + (activeHref ?? ""));
    if (openKey) setOpenKey(null);
  }

  useEffect(() => {
    if (!openKey) return;
    const onDown = (e: PointerEvent) => {
      if (asideRef.current && !asideRef.current.contains(e.target as Node)) setOpenKey(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const key = openKey;
      setOpenKey(null);
      itemRefs.current.get(key)?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openKey]);

  // Keyboard users land on the first page of the panel they just opened.
  useEffect(() => {
    if (openKey) panelRef.current?.querySelector<HTMLElement>("a, button")?.focus({ preventScroll: true });
  }, [openKey]);

  const prefetch = (entry: RailEntry) => {
    if (prefetched.current.has(entry.key)) return;
    prefetched.current.add(entry.key);
    const list = entry.kind === "link" ? [entry.link] : [...entry.pages, ...entry.dashboards];
    for (const l of list) if (!l.external) router.prefetch(l.href.split("?")[0]);
  };

  const open = (entry: Extract<RailEntry, { kind: "menu" }>) => {
    const el = itemRefs.current.get(entry.key);
    if (openKey === entry.key) return setOpenKey(null);
    setPanelTop(Math.max(12, (el?.getBoundingClientRect().top ?? 12) - 6));
    setOpenKey(entry.key);
  };

  /** A dashboard link on the dashboard page that is already open: switch its tab right here (instant, no reload). */
  const onDashboardClick = (e: React.MouseEvent, link: RailLink) => {
    setOpenKey(null);
    const [path, query] = link.href.split("?");
    const tab = new URLSearchParams(query).get("tab");
    if (!tab || path !== pathname) return;
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("kpi-tab", { detail: tab }));
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url.pathname + url.search);
  };

  const hasBadge = (entry: RailEntry) => (entry.kind === "link" ? !!entry.link.badge : entry.pages.some((p) => p.badge) || entry.dashboards.some((p) => p.badge));

  const item = (entry: RailEntry) => {
    const active = activeKey === entry.key;
    const cls = `rail-item ${active ? "rail-item-on" : ""} ${active && !placed ? "rail-item-solo" : ""}`;
    const setRef = (el: HTMLElement | null) => {
      if (el) itemRefs.current.set(entry.key, el);
      else itemRefs.current.delete(entry.key);
    };
    const icon = entry.icon ? <KeyIcon name={entry.icon} size={20} /> : entry.kind === "link" ? <NavIcon href={entry.link.href} label={entry.link.label} size={20} /> : null;
    const inner = (
      <>
        {icon}
        {hasBadge(entry) && <span aria-hidden="true" className="rail-dot" />}
        {openKey !== entry.key && (
          <span className="rail-tip" role="tooltip">
            {entry.label}
          </span>
        )}
        <span className="sr-only">{entry.label}</span>
      </>
    );
    return (
      <li key={entry.key}>
        {entry.kind === "menu" ? (
          <button
            type="button"
            ref={setRef}
            className={cls}
            onClick={() => open(entry)}
            onMouseEnter={() => prefetch(entry)}
            onFocus={() => prefetch(entry)}
            aria-expanded={openKey === entry.key}
            aria-haspopup="true"
          >
            {inner}
          </button>
        ) : entry.link.external ? (
          <a ref={setRef} href={entry.link.href} target="_blank" rel="noopener noreferrer" className={cls}>
            {inner}
          </a>
        ) : (
          <Link ref={setRef} href={entry.link.href} aria-current={active ? "page" : undefined} className={cls} onMouseEnter={() => prefetch(entry)}>
            {inner}
          </Link>
        )}
      </li>
    );
  };

  const bottomEntries: RailEntry[] = model.bottom.map((l) => ({ kind: "link", key: `bottom:${l.href}`, label: l.title ?? l.label, icon: "", link: l }));

  const openEntry = model.top.find((e) => e.key === openKey);

  const pageLink = (l: RailLink, isDashboard: boolean) => {
    const current = !l.external && pageHref === l.href;
    const cls = `rail-row ${current ? "rail-row-on" : ""}`;
    const body = (
      <>
        <span className="min-w-0 truncate">{l.label}</span>
        {l.badge && <span className="rail-badge">{l.badge}</span>}
        {l.external && <span aria-hidden="true" className="text-[11px] opacity-60">↗</span>}
      </>
    );
    return l.external ? (
      <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className={cls} onClick={() => setOpenKey(null)}>
        {body}
      </a>
    ) : (
      <Link key={l.href} href={l.href} aria-current={current ? "page" : undefined} className={cls} onClick={isDashboard ? (e) => onDashboardClick(e, l) : () => setOpenKey(null)}>
        {body}
      </Link>
    );
  };

  const panel = openEntry && openEntry.kind === "menu" && (
    <div ref={panelRef} className="rail-panel" style={{ top: panelTop, maxHeight: `calc(100vh - ${panelTop}px - 12px)` }} role="group" aria-label={openEntry.label}>
      <p className="rail-panel-title">{openEntry.label}</p>
      {openEntry.pages.length > 0 && <div className="rail-rows">{openEntry.pages.map((l) => pageLink(l, false))}</div>}
      {openEntry.key === "kpis"
        ? (Object.keys(DEPT_LABEL) as RailDept[]).map((d) => {
            const list = openEntry.dashboards.filter((k) => k.dept === d);
            return list.length ? (
              <div key={d}>
                <p className="rail-panel-head">{DEPT_LABEL[d]}</p>
                <div className="rail-rows">{list.map((l) => pageLink(l, true))}</div>
              </div>
            ) : null;
          })
        : openEntry.dashboards.length > 0 && (
            <div>
              <p className="rail-panel-head">Dashboards</p>
              <div className="rail-rows">{openEntry.dashboards.map((l) => pageLink(l, true))}</div>
            </div>
          )}
    </div>
  );

  return (
    <aside ref={asideRef} aria-label="Main menu" className="app-rail hidden print:hidden xl:flex">
      <Link href="/" aria-label="Home" className="rail-logo">
        <Image src="/mg-logo.png" alt="" width={1037} height={1024} priority className="h-[1.875rem] w-auto" />
      </Link>
      <div ref={bodyRef} className="rail-body">
        <span
          aria-hidden="true"
          className="rail-marker"
          style={{ transform: `translateY(${marker?.y ?? 0}px)`, opacity: marker ? 1 : 0, transition: glide ? undefined : "none" }}
        />
        <ul className="rail-list">{model.top.map(item)}</ul>
        <ul className="rail-list rail-list-bottom">{bottomEntries.map(item)}</ul>
      </div>
      {panel}
    </aside>
  );
}
