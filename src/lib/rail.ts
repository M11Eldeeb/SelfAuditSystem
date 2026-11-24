// The desktop rail: the links an area's layout hands to the NavBar, sorted into departments. Pure (no imports) so a plain
// Node test can run it - see scripts/rail.test.mjs.

export type RailDept = "service" | "warranty" | "technical" | "quality" | "parts";

export type RailLink = {
  href: string;
  label: string;
  /** The name shown in the top bar / tooltips when it differs from the short label. */
  title?: string;
  match?: string[];
  badge?: string;
  external?: boolean;
  bottom?: boolean;
  group?: string;
};

/** A dashboard (or other KPI page) and the department it belongs to. */
export type RailKpi = RailLink & { dept: RailDept };

export type RailEntry =
  | { kind: "link"; key: string; label: string; icon: string; link: RailLink }
  | { kind: "menu"; key: string; label: string; icon: string; pages: RailLink[]; dashboards: RailKpi[] };

export type RailModel = { top: RailEntry[]; bottom: RailLink[] };

/** Links with this group are the customer queue's pages (one folder in the menu). */
export const QUEUE_GROUP = "Customer Queue";

/** The dashboard the "Dashboard" entry opens: the warranty Overview when there is one, else the first. */
export function mainDashboard(kpis: RailKpi[]): RailKpi | undefined {
  return kpis.find((k) => k.href.includes("tab=overview")) ?? kpis[0];
}

export const DEPT_LABEL: Record<RailDept, string> = { service: "Service", warranty: "Warranty", technical: "Technical", quality: "Quality", parts: "Parts" };
/** Department -> icon key of nav-icons.tsx. */
const DEPT_ICON: Record<RailDept, string> = { service: "wrench", warranty: "shield", technical: "gear", quality: "quality", parts: "box" };
const ORDER: RailDept[] = ["service", "warranty", "technical", "quality", "parts"];

/** Which department(s) a link belongs to, "query" / "complaints" / "dashboard" for the special ones, null when it fits none. */
export function departmentsOf(link: RailLink): RailDept[] | "home" | "query" | "complaints" | "dashboard" | null {
  if (link.external) return link.href.includes("portal.smil.com") ? ["warranty", "technical"] : null;
  const path = link.href.split("?")[0].toLowerCase().replace(/\/+$/, "");
  if (/^\/[a-z]+\/home$/.test(path)) return "home";
  if (/\/dashboard$/.test(path)) return "dashboard";
  if (/\/query$/.test(path)) return "query";
  if (/\/complaints$/.test(path)) return "complaints";
  if (/\/(msi|open-wips|courtesy-cars)$/.test(path) || path === "/queue") return ["service"];
  if (/\/(audits|warranty-room|technician-claims|rejected-claims|reconciliation|sub-dealer)$/.test(path) || path === "/audit") return ["warranty"];
  if (/\/documents$/.test(path)) return ["warranty", "technical"];
  if (/\/(technical-inquiries|verification-codes)$/.test(path)) return ["technical"];
  if (/\/quality-control$/.test(path) || path === "/qc" || path.startsWith("/qc/")) return ["quality"];
  if (/\/vor-parts$/.test(path)) return ["parts"];
  return null;
}

const same = (a: string, b: string) => a === b;

export function buildRail(links: RailLink[], kpis: RailKpi[]): RailModel {
  const pages: Record<RailDept, RailLink[]> = { service: [], warranty: [], technical: [], quality: [], parts: [] };
  const bottom: RailLink[] = [];
  const dashLinks: RailLink[] = [];
  const others: RailLink[] = [];
  let home: RailLink | undefined;
  let query: RailLink | undefined;
  let complaints: RailLink | undefined;
  /** The customer queue's own pages (shown inside the portal while working in the queue): one folder. */
  const queue: RailLink[] = [];

  for (const link of links) {
    if (link.bottom) {
      bottom.push(link);
      continue;
    }
    if (link.group === QUEUE_GROUP) {
      queue.push(link);
      continue;
    }
    const d = departmentsOf(link);
    if (d === "home") home = link;
    else if (d === "query") query = link;
    else if (d === "complaints") complaints = link;
    else if (d === "dashboard") dashLinks.push(link);
    else if (Array.isArray(d)) {
      for (const dept of d) if (!pages[dept].some((p) => same(p.href, link.href))) pages[dept].push(link);
    } else others.push(link);
  }

  // The KPI entries; a role that only has its own Dashboard link gets that one, under Warranty.
  const entries: RailKpi[] = kpis.length ? kpis : dashLinks.map((l) => ({ ...l, dept: "warranty" as const }));

  const top: RailEntry[] = [];
  if (home) top.push({ kind: "link", key: "home", label: home.label, icon: "home", link: home });
  if (query) top.push({ kind: "link", key: "query", label: query.title ?? query.label, icon: "query", link: query });
  // One "Dashboard" entry: it opens the dashboard screen, where a bar picks the department and the dashboard.
  if (entries.length) top.push({ kind: "menu", key: "kpis", label: "Dashboard", icon: "dashboard", pages: [], dashboards: entries });
  for (const dept of ORDER) {
    const own = pages[dept];
    if (!own.length) continue;
    if (own.length === 1) top.push({ kind: "link", key: dept, label: own[0].title ?? own[0].label, icon: DEPT_ICON[dept], link: own[0] });
    else top.push({ kind: "menu", key: dept, label: DEPT_LABEL[dept], icon: DEPT_ICON[dept], pages: own, dashboards: [] });
    if (dept === "service" && queue.length) top.push({ kind: "menu", key: "queue", label: "Customer Queue", icon: "queue", pages: queue, dashboards: [] });
  }
  if (queue.length && !pages.service.length) top.push({ kind: "menu", key: "queue", label: "Customer Queue", icon: "queue", pages: queue, dashboards: [] });
  if (complaints) top.push({ kind: "link", key: "complaints", label: complaints.title ?? complaints.label, icon: "complaints", link: complaints });
  for (const l of others) top.push({ kind: "link", key: l.href, label: l.title ?? l.label, icon: "", link: l });
  return { top, bottom };
}

/** Which rail button carries the white marker for the current page (null = none). Pages win over dashboards; KPIs win over a department's copy of a dashboard. */
export function railActiveKey(model: RailModel, activeHref: string | undefined): string | null {
  if (!activeHref) return null;
  const hit = (l: RailLink) => !l.external && same(l.href, activeHref);
  for (const e of model.top) {
    if (e.kind === "link" ? hit(e.link) : e.pages.some(hit)) return e.key;
  }
  const kpis = model.top.find((e) => e.key === "kpis");
  if (kpis?.kind === "menu" && kpis.dashboards.some(hit)) return "kpis";
  for (const e of model.top) if (e.kind === "menu" && e.dashboards.some(hit)) return e.key;
  const b = model.bottom.find(hit);
  return b ? `bottom:${b.href}` : null;
}
