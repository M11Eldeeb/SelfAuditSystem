"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DEPT_LABEL, mainDashboard, type RailDept, type RailKpi } from "@/lib/rail";
import { KeyIcon } from "@/components/nav-icons";

const ORDER: RailDept[] = ["warranty", "quality", "service", "technical", "parts"];
const DEPT_ICON: Record<RailDept, string> = { service: "wrench", warranty: "shield", technical: "gear", quality: "quality", parts: "box" };

/** The dashboard open on this page (null when the page is not one of the dashboards). The dashboard page with no ?tab= is its Overview. */
export function currentDashboard(kpis: RailKpi[], pathname: string, search: URLSearchParams | null): RailKpi | null {
  const onPath = kpis.filter((k) => k.href.split("?")[0] === pathname);
  if (!onPath.length) return null;
  const tab = search?.get("tab");
  const withTab = tab ? onPath.find((k) => new URLSearchParams(k.href.split("?")[1] ?? "").get("tab") === tab) : undefined;
  return withTab ?? onPath.find((k) => !k.href.includes("?")) ?? mainDashboard(onPath) ?? null;
}

/**
 * The dashboard screen's switcher, under the top bar: a small bar of departments (Warranty, Quality, Service ...) and under it
 * the dashboards of the chosen department. A dashboard tab of the page already open switches right here (no reload).
 */
export function DashboardBar({ kpis }: { kpis: RailKpi[] }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const current = currentDashboard(kpis, pathname, search);
  if (!current || kpis.length < 2) return null;
  const depts = ORDER.filter((d) => kpis.some((k) => k.dept === d));
  const list = kpis.filter((k) => k.dept === current.dept);

  /** A tab of the dashboard page already open: switched right here (true); else the link loads its page. */
  const switchHere = (k: RailKpi) => {
    const [path, query] = k.href.split("?");
    const tab = new URLSearchParams(query ?? "").get("tab");
    if (!tab || path !== pathname) return false;
    window.dispatchEvent(new CustomEvent("kpi-tab", { detail: tab }));
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url.pathname + url.search);
    return true;
  };

  return (
    <div className="dash-bar px-3 pt-3 print:hidden">
      <div className="mx-auto w-full max-w-5xl space-y-2 px-1">
        {depts.length > 1 && (
          <div role="tablist" aria-label="Department" className="flex gap-1 overflow-x-auto">
            {depts.map((d) => {
              const active = d === current.dept;
              return (
                <button
                  key={d}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    if (active) return;
                    const first = kpis.filter((k) => k.dept === d);
                    const go = mainDashboard(first);
                    if (go && !switchHere(go)) router.push(go.href);
                  }}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold transition ${
                    active ? "bg-neutral-900 text-white" : "bg-white text-neutral-600 ring-1 ring-neutral-900/[0.08] hover:bg-neutral-50 hover:text-neutral-900"
                  }`}
                >
                  <KeyIcon name={DEPT_ICON[d]} size={14} />
                  {DEPT_LABEL[d]}
                </button>
              );
            })}
          </div>
        )}
        <nav aria-label="Dashboards" className="flex gap-0.5 overflow-x-auto rounded-[14px] bg-[#e9e9ec]/85 p-[3px] backdrop-blur-xl">
          {list.map((k) => {
            const active = k.href === current.href;
            return (
              <Link
                key={k.href}
                href={k.href}
                onClick={(e) => {
                  if (switchHere(k)) e.preventDefault();
                }}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 rounded-[11px] px-3.5 py-1.5 text-[13.5px] font-semibold whitespace-nowrap transition ${
                  active ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"
                }`}
              >
                {k.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
