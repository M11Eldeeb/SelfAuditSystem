export const DASHBOARD_TABS = [
  { id: "quality", label: "Quality Dashboard", title: "Quality control", officerOnly: false, managerOnly: false },
  { id: "overview", label: "Overview", title: "Warranty KPI overview", officerOnly: false, managerOnly: false },
  { id: "audits", label: "Audits", title: "Audits", officerOnly: false, managerOnly: true },
  { id: "cycle", label: "Cycle Times & SLA", title: "Cycle times & SLA", officerOnly: false, managerOnly: false },
  { id: "financials", label: "Claims & Financials", title: "Claims & financials", officerOnly: false, managerOnly: false },
  { id: "warranty", label: "Warranty Room", title: "Warranty Room", officerOnly: false, managerOnly: false },
  { id: "trends", label: "Trends & Repeats", title: "Trends & repeat repairs", officerOnly: true, managerOnly: false },
  { id: "subdealer", label: "Sub-dealer Dashboard", title: "Sub-dealer Dashboard", officerOnly: false, managerOnly: true },
] as const;

export type DashboardTab = (typeof DASHBOARD_TABS)[number]["id"];

/** What a manager (or service manager) sees: the Warranty Overview, the Audits podium and the Sub-dealer Dashboard. */
const MANAGER_TABS: readonly DashboardTab[] = ["overview", "audits", "subdealer"];

/** The tabs of the dashboard for this kind of user. */
export function tabsFor(isOfficer: boolean, manager: boolean, national = false) {
  // The national manager has the officer's tabs and the Audits tab (the audits are a tab of the dashboard, not a menu entry).
  return DASHBOARD_TABS.filter((t) => (manager ? MANAGER_TABS.includes(t.id) : national ? t.id !== "subdealer" : (!t.officerOnly || isOfficer) && !t.managerOnly));
}

/** The manager's overview carries its own name. */
export function tabLabel(t: { id: DashboardTab; label: string }, manager: boolean): string {
  return manager && t.id === "overview" ? "Warranty Overview" : t.label;
}

export function parseTab(value: string | undefined, isOfficer = false, manager = false, national = false): DashboardTab {
  // Warranty Invoicing is part of Claims & Financials now (old links and the Gmail connect step still say "invoicing").
  if (value === "invoicing") value = "financials";
  // Prior Approvals is a section of the Warranty tab (which also holds Warranty Room & Parts).
  if (value === "prior") value = "warranty";
  // Tasks moved to their own page (from the notification bell).
  if (value === "tasks") value = "overview";
  const tab = tabsFor(isOfficer, manager, national).find((t) => t.id === value);
  return tab ? tab.id : "overview";
}
