"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { DEPT_LABEL, mainDashboard, type RailDept, type RailKpi } from "@/lib/rail";
import { KeyIcon } from "@/components/nav-icons";

const ORDER: RailDept[] = ["warranty", "quality", "service", "technical", "parts", "complaints"];
const DEPT_ICON: Record<RailDept, string> = { service: "wrench", warranty: "shield", technical: "gear", quality: "quality", parts: "box", complaints: "complaints" };

const tabOf = (href: string) => new URLSearchParams(href.split("?")[1] ?? "").get("tab");

/**
 * The dashboard open on this page (null when the page is not one of the dashboards). With ?tab= the dashboard of that tab;
 * without, the page's own dashboard (the KPI dashboard's Overview, the first complaints view).
 */
export function currentDashboard(kpis: RailKpi[], pathname: string, search: URLSearchParams | null): RailKpi | null {
  const onPath = kpis.filter((k) => k.href.split("?")[0] === pathname);
  if (!onPath.length) return null;
  // The dashboard whose ?tab= / ?view= the page has (the one asking the most wins).
  const params = (k: RailKpi) => [...new URLSearchParams(k.href.split("?")[1] ?? "")];
  const hit = onPath
    .filter((k) => params(k).length && params(k).every(([key, v]) => search?.get(key) === v))
    .sort((a, b) => params(b).length - params(a).length)[0];
  if (hit) return hit;
  if (search?.get("tab") || search?.get("view")) return null;
  // No ?tab=: the page's own dashboard (the KPI dashboard's Overview, the first complaints view).
  const plain = onPath.find((k) => !k.href.includes("?"));
  if (plain) return plain;
  return /\/(dashboard|complaints)$/.test(pathname) ? (mainDashboard(onPath) ?? null) : null;
}

/**
 * A segmented control whose white pill slides to the chosen item (the motion when switching). The pill is placed straight on
 * the DOM after each render, so it follows the chosen item without a second render.
 */
function Segmented({ label, activeKey, items }: { label: string; activeKey: string; items: { key: string; node: (cls: string) => ReactNode }[] }) {
  const box = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(`[data-seg="${CSS.escape(activeKey)}"]`);
    const p = pill.current;
    if (!el || !p) return;
    // No slide on the first paint, only when switching.
    p.style.transition = first.current ? "none" : "";
    p.style.transform = `translateX(${el.offsetLeft}px)`;
    p.style.width = `${el.offsetWidth}px`;
    p.style.opacity = "1";
    first.current = false;
  });
  return (
    <div ref={box} role="tablist" aria-label={label} className="relative inline-flex max-w-full gap-0.5 overflow-x-auto rounded-[14px] bg-[#e9e9ec]/85 p-[3px] backdrop-blur-xl [scrollbar-width:none]">
      <span
        ref={pill}
        aria-hidden="true"
        className="absolute top-[3px] bottom-[3px] left-0 rounded-[11px] bg-white opacity-0 shadow-sm transition-[transform,width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
      />
      {items.map((it) =>
        it.node(
          `relative z-[1] flex shrink-0 items-center gap-1.5 rounded-[11px] px-3.5 py-1.5 text-[13.5px] font-semibold whitespace-nowrap transition-colors duration-200 ${
            it.key === activeKey ? "text-neutral-900" : "text-neutral-500 hover:text-neutral-900"
          }`
        )
      )}
    </div>
  );
}

/**
 * The dashboard screen's switcher, under the top bar: the departments (Warranty, Quality, Service, Complaints ...) and under them
 * the dashboards of the chosen one, both as sliding segmented controls; the lower one is only as wide as its tabs.
 * A tab of the dashboard page already open switches right there (no reload).
 */
export function DashboardBar({ kpis }: { kpis: RailKpi[] }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const current = currentDashboard(kpis, pathname, search);
  // The tab just clicked shows as chosen at once, while its page loads.
  const [pending, setPending] = useState<string | null>(null);
  const [lastCurrent, setLastCurrent] = useState(current?.href);
  if (current?.href !== lastCurrent) {
    setLastCurrent(current?.href);
    setPending(null);
  }
  if (!current || kpis.length < 2) return null;
  const shown = kpis.find((k) => k.href === pending) ?? current;
  const depts = ORDER.filter((d) => kpis.some((k) => k.dept === d));
  const list = kpis.filter((k) => k.dept === shown.dept);

  /** A tab of the KPI dashboard or of the complaints page already open: switched right here (true); else its page loads. */
  const switchHere = (k: RailKpi) => {
    const path = k.href.split("?")[0];
    const tab = tabOf(k.href);
    if (!tab || path !== pathname || !/\/(dashboard|complaints)$/.test(path)) return false;
    window.dispatchEvent(new CustomEvent("kpi-tab", { detail: tab }));
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url.pathname + url.search);
    return true;
  };
  const go = (k: RailKpi) => {
    if (k.href === shown.href) return;
    setPending(k.href);
    if (!switchHere(k)) router.push(k.href);
  };

  return (
    <div className="dash-bar px-3 pt-3 print:hidden">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-start gap-2 px-1">
        {depts.length > 1 && (
          <Segmented
            label="Department"
            activeKey={shown.dept}
            items={depts.map((d) => ({
              key: d,
              node: (cls) => (
                <button
                  key={d}
                  type="button"
                  role="tab"
                  data-seg={d}
                  aria-selected={d === shown.dept}
                  onClick={() => {
                    const target = mainDashboard(kpis.filter((k) => k.dept === d));
                    if (target) go(target);
                  }}
                  className={cls}
                >
                  <KeyIcon name={DEPT_ICON[d]} size={15} />
                  {DEPT_LABEL[d]}
                </button>
              ),
            }))}
          />
        )}
        {/* Keyed by department: a new set of dashboards comes in with a short rise. */}
        <div key={shown.dept} className="dash-bar-in max-w-full">
          <Segmented
            label="Dashboards"
            activeKey={shown.href}
            items={list.map((k) => ({
              key: k.href,
              node: (cls) => (
                <Link
                  key={k.href}
                  href={k.href}
                  data-seg={k.href}
                  role="tab"
                  aria-selected={k.href === shown.href}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                    e.preventDefault();
                    go(k);
                  }}
                  className={cls}
                >
                  {k.label}
                </Link>
              ),
            }))}
          />
        </div>
      </div>
    </div>
  );
}
