"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { KeyIcon, NavIcon } from "@/components/nav-icons";
import { buildRail, mainDashboard, railActiveKey, type RailEntry, type RailKpi, type RailLink } from "@/lib/rail";

const OPEN_KEY = "sidebar-dept-open";

/**
 * The desktop navigation (1280 px and up): the docked light sidebar, with the links sorted into departments (lib/rail.ts).
 * A department is a folder that opens in place with its pages; only one is open at a time (opening one closes the other).
 * The one holding the current page opens by itself; the one left open is kept in this browser. One "Dashboard" entry opens
 * the dashboard screen (its bar picks the department and the dashboard). Below 1280 px NavBar shows its drawer instead.
 */
export function DeptSidebar({ links, kpis, activeHref, header, footer }: { links: RailLink[]; kpis: RailKpi[]; activeHref: string | undefined; header: ReactNode; footer: ReactNode }) {
  const model = useMemo(() => buildRail(links, kpis), [links, kpis]);
  // The dashboard page with no ?tab= is its Overview; its KPI entry is the current one.
  const pageHref = useMemo(() => {
    if (!activeHref) return activeHref;
    if (railActiveKey(model, activeHref)) return activeHref;
    const path = activeHref.split("?")[0];
    const same = kpis.filter((k) => k.href.split("?")[0] === path);
    return (same.find((k) => k.href.includes("tab=overview")) ?? same[0])?.href ?? activeHref;
  }, [model, kpis, activeHref]);
  const activeKey = railActiveKey(model, pageHref);

  // One folder open at a time: the one holding the current page, else the one left open last time.
  const [openKey, setOpenKey] = useState<string | null>(activeKey);
  useEffect(() => {
    if (activeKey) return;
    queueMicrotask(() => {
      try {
        const saved = localStorage.getItem(OPEN_KEY);
        if (saved) setOpenKey(saved);
      } catch {
        // private window: nothing saved
      }
    });
  }, [activeKey]);
  // Moving to a page in another folder opens that one (and closes the rest).
  const [lastKey, setLastKey] = useState(activeKey);
  if (activeKey !== lastKey) {
    setLastKey(activeKey);
    if (activeKey) setOpenKey(activeKey);
  }

  const toggle = (key: string) => {
    const next = openKey === key ? null : key;
    setOpenKey(next);
    try {
      if (next) localStorage.setItem(OPEN_KEY, next);
      else localStorage.removeItem(OPEN_KEY);
    } catch {
      // private window: the choice lasts for this page only
    }
  };

  const row = (l: RailLink, opts: { compact?: boolean; icon?: ReactNode } = {}) => {
    const current = !l.external && pageHref === l.href;
    const className = `flex ${opts.compact ? "min-h-9 gap-2.5 px-2.5 py-1.5 text-[14px]" : "min-h-10 gap-3 px-3 py-2 text-[15px]"} items-center rounded-xl leading-snug transition-colors ${
      current ? "bg-neutral-900/[0.07] font-semibold text-neutral-900" : "font-medium text-neutral-700 hover:bg-neutral-900/[0.04] hover:text-neutral-900"
    }`;
    const content = (
      <>
        <span className="text-brand">{opts.icon ?? <NavIcon href={l.href} label={l.label} size={opts.compact ? 18 : 20} />}</span>
        <span className="min-w-0 flex-1">{l.label}</span>
        {l.badge && <span className="shrink-0 rounded-full bg-neutral-900/[0.07] px-2 py-0.5 text-[12px] font-semibold tabular-nums text-neutral-600">{l.badge}</span>}
        {l.external && (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-neutral-400">
            <path d="M9 3h4v4M13 3L7.5 8.5M12 9.5V12a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1h2.5" />
          </svg>
        )}
      </>
    );
    return l.external ? (
      <a href={l.href} target="_blank" rel="noopener noreferrer" title={`${l.label} - opens in a new tab`} className={className}>
        {content}
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    ) : (
      <Link href={l.href} aria-current={current ? "page" : undefined} className={className}>
        {content}
      </Link>
    );
  };

  const subList = (list: RailLink[]) => (
    <ul className="space-y-0.5">
      {list.map((l) => (
        <li key={l.href}>{row(l, { compact: true })}</li>
      ))}
    </ul>
  );

  const entry = (e: RailEntry) => {
    const icon = e.icon ? <KeyIcon name={e.icon} size={20} /> : undefined;
    if (e.kind === "link") return <li key={e.key}>{row({ ...e.link, label: e.label }, { icon })}</li>;
    // The one Dashboard entry: opens the dashboard screen (current while any dashboard is open).
    if (e.key === "kpis") {
      const main = mainDashboard(e.dashboards);
      if (!main) return null;
      const current = activeKey === "kpis";
      return (
        <li key={e.key}>
          <Link
            href={main.href}
            aria-current={current ? "page" : undefined}
            className={`flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-[15px] leading-snug transition-colors ${current ? "bg-neutral-900/[0.07] font-semibold text-neutral-900" : "font-medium text-neutral-700 hover:bg-neutral-900/[0.04] hover:text-neutral-900"}`}
          >
            <span className="text-brand">{icon}</span>
            <span className="min-w-0 flex-1">{e.label}</span>
          </Link>
        </li>
      );
    }
    const isOpen = openKey === e.key;
    const badge = e.pages.some((p) => p.badge) || e.dashboards.some((p) => p.badge);
    return (
      <li key={e.key}>
        <button
          type="button"
          onClick={() => toggle(e.key)}
          aria-expanded={isOpen}
          className={`flex min-h-10 w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left text-[15px] leading-snug transition-colors hover:bg-neutral-900/[0.04] ${
            activeKey === e.key && !isOpen ? "bg-neutral-900/[0.07] font-semibold text-neutral-900" : "font-medium text-neutral-700"
          }`}
        >
          <span className="text-brand">{icon}</span>
          <span className="min-w-0 flex-1 truncate">{e.label}</span>
          {badge && !isOpen && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-brand" />}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className={`shrink-0 text-neutral-400 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}>
            <path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {/* Always mounted so it can slide open and shut (grid rows 0fr <-> 1fr). */}
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
          inert={!isOpen}
        >
          <div className="overflow-hidden">
            <div className="mt-1 mb-1 ml-[1.35rem] border-l border-neutral-900/[0.08] pl-2">
              {e.pages.length > 0 && subList(e.pages)}
            </div>
          </div>
        </div>
      </li>
    );
  };

  return (
    <aside
      aria-label="Main menu"
      className="app-sidebar fixed top-3 bottom-3 left-3 z-30 hidden w-72 flex-col rounded-[22px] bg-[var(--surface)] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_48px_-16px_rgba(0,0,0,0.22)] ring-1 ring-neutral-900/[0.07] print:hidden xl:flex"
    >
      {header}
      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        <ul className="space-y-1">{model.top.map(entry)}</ul>
      </nav>
      {model.bottom.length > 0 && (
        <div className="px-3 pb-1.5">
          <ul className="space-y-1">
            {model.bottom.map((l) => (
              <li key={l.href}>{row(l)}</li>
            ))}
          </ul>
        </div>
      )}
      {footer}
    </aside>
  );
}
