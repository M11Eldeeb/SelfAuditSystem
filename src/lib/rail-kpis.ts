// The KPI entries of the rail: one per dashboard tab the role can open, each opening that dashboard alone. Pure (no imports).
import type { RailDept, RailKpi } from "./rail";

type Tab = { id: string; label: string; title: string };

/**
 * `tabs` is what tabsFor(...) gives for this role; `quality` / `subDealer` say whether the Quality and Sub-dealer tabs are really
 * on the page (KpiDashboard drops them otherwise). `extra` are further KPI pages (Major Service Indicators, Audits, ...).
 */
export function kpiLinks(o: { base: string; tabs: readonly Tab[]; quality?: boolean; subDealer?: boolean; extra?: RailKpi[] }): RailKpi[] {
  const out: RailKpi[] = o.tabs
    .filter((t) => (t.id !== "quality" || o.quality) && (t.id !== "subdealer" || o.subDealer))
    .map((t) => ({ href: `${o.base}?tab=${t.id}`, label: t.label, title: t.title, dept: (t.id === "quality" ? "quality" : "warranty") as RailDept }));
  return [...out, ...(o.extra ?? [])];
}
