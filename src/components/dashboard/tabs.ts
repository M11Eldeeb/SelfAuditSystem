export const DASHBOARD_TABS = [
  { id: "quality", label: "Quality Dashboard", title: "Quality control", officerOnly: false, managerOnly: false },
  { id: "overview", label: "Overview", title: "Warranty KPI overview", officerOnly: false, managerOnly: false },
  { id: "cycle", label: "Cycle Times & SLA", title: "Cycle times & SLA", officerOnly: false, managerOnly: false },
  { id: "financials", label: "Claims & Financials", title: "Claims & financials", officerOnly: false, managerOnly: false },
  { id: "warranty", label: "Warranty Room", title: "Warranty Room", officerOnly: false, managerOnly: false },
  { id: "trends", label: "Trends & Repeats", title: "Trends & repeat repairs", officerOnly: true, managerOnly: false },
  { id: "audits", label: "Audits", title: "Audits", officerOnly: false, managerOnly: true },
] as const;

export type DashboardTab = (typeof DASHBOARD_TABS)[number]["id"];

/** What a manager (or service manager) sees: the quality dashboard, the Warranty Overview and the Audits podium. */
const MANAGER_TABS: readonly DashboardTab[] = ["quality", "overview", "audits"];

/** The tabs of the dashboard for this kind of user. */
export function tabsFor(isOfficer: boolean, manager: boolean) {
  return DASHBOARD_TABS.filter((t) => (manager ? MANAGER_TABS.includes(t.id) : (!t.officerOnly || isOfficer) && !t.managerOnly));
}

/** The manager's overview carries its own name. */
export function tabLabel(t: { id: DashboardTab; label: string }, manager: boolean): string {
  return manager && t.id === "overview" ? "Warranty Overview" : t.label;
}

export function parseTab(value: string | undefined, isOfficer = false, manager = false): DashboardTab {
  // Warranty Invoicing is part of Claims & Financials now (old links and the Gmail connect step still say "invoicing").
  if (value === "invoicing") value = "financials";
  // Prior Approvals is a section of the Warranty tab (which also holds Warranty Room & Parts).
  if (value === "prior") value = "warranty";
  // Tasks moved to their own page (from the notification bell).
  if (value === "tasks") value = "overview";
  const tab = tabsFor(isOfficer, manager).find((t) => t.id === value);
  return tab ? tab.id : "overview";
}
