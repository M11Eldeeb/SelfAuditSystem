"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { KeyIcon, NavIcon } from "@/components/nav-icons";
import { DEPT_LABEL, buildRail, railActiveKey, type RailDept, type RailEntry, type RailKpi, type RailLink } from "@/lib/rail";

const OPEN_KEY = "sidebar-depts-open";

/**
 * The desktop navigation (1280 px and up): the docked light sidebar, with the links sorted into departments (lib/rail.ts).
 * A department is a folder that opens in place with its pages and its dashboards; the one holding the current page opens
 * by itself, and the folders left open are kept in this browser. Below 1280 px NavBar shows its drawer instead.
 */
export function DeptSidebar({ links, kpis, activeHref, header, footer }: { links: RailLink[]; kpis: RailKpi[]; activeHref: string | undefined; header: ReactNode; footer: ReactNode }) {
  const pathname = usePathname();
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

  const [open, setOpen] = useState<Set<string>>(() => new Set(activeKey ? [activeKey] : []));
  // The folders left open last time come back after the first paint (the server cannot know them).
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "null");
        if (Array.isArray(saved)) setOpen((s) => new Set([...s, ...saved.filter((k): k is string => typeof k === "string")]));
      } catch {
        // private window / bad value: only the current folder is open
      }
    });
  }, []);
  // Moving to a page in a closed folder opens it.
  const [lastKey, setLastKey] = useState(activeKey);
  if (activeKey !== lastKey) {
    setLastKey(activeKey);
    if (activeKey && !open.has(activeKey)) setOpen(new Set([...open, activeKey]));
  }

  const toggle = (key: string) => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
    } catch {
      // private window: the choice lasts for this page only
    }
  };

  /** A dashboard link on the dashboard page that is already open: switch its tab right here (instant, no reload). */
  const onDashboardClick = (e: React.MouseEvent, link: RailLink) => {
    const [path, query] = link.href.split("?");
    const tab = new URLSearchParams(query).get("tab");
    if (!tab || path !== pathname) return;
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("kpi-tab", { detail: tab }));
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url.pathname + url.search);
  };

  const row = (l: RailLink, opts: { compact?: boolean; icon?: ReactNode; dashboard?: boolean } = {}) => {
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
      <Link href={l.href} aria-current={current ? "page" : undefined} className={className} onClick={opts.dashboard ? (e) => onDashboardClick(e, l) : undefined}>
        {content}
      </Link>
    );
  };

  const subHead = (text: string) => <p className="px-2.5 pt-2 pb-0.5 text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">{text}</p>;
  const subList = (list: RailLink[], dashboard: boolean) => (
    <ul className="space-y-0.5">
      {list.map((l) => (
        <li key={l.href}>{row(l, { compact: true, dashboard })}</li>
      ))}
    </ul>
  );

  const entry = (e: RailEntry) => {
    const icon = e.icon ? <KeyIcon name={e.icon} size={20} /> : undefined;
    if (e.kind === "link") return <li key={e.key}>{row({ ...e.link, label: e.label }, { icon })}</li>;
    const isOpen = open.has(e.key);
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
              {e.pages.length > 0 && subList(e.pages, false)}
              {e.key === "kpis"
                ? (Object.keys(DEPT_LABEL) as RailDept[]).map((d) => {
                    const list = e.dashboards.filter((k) => k.dept === d);
                    return list.length ? (
                      <div key={d}>
                        {subHead(DEPT_LABEL[d])}
                        {subList(list, true)}
                      </div>
                    ) : null;
                  })
                : e.dashboards.length > 0 && (
                    <div>
                      {subHead("Dashboards")}
                      {subList(e.dashboards, true)}
                    </div>
                  )}
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
