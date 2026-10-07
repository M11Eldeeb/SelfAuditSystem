export const DASHBOARD_TABS = [
  { id: "overview", label: "Overview", title: "Warranty KPI overview", officerOnly: false },
  { id: "cycle", label: "Cycle Times & SLA", title: "Cycle times & SLA", officerOnly: false },
  { id: "financials", label: "Claims & Financials", title: "Claims & financials", officerOnly: false },
  { id: "warranty", label: "Warranty Room & Parts", title: "Warranty room & parts", officerOnly: false },
  { id: "trends", label: "Trends & Repeats", title: "Trends & repeat repairs", officerOnly: true },
  { id: "reconciliation", label: "Reconciliation", title: "Settlement reconciliation", officerOnly: true },
] as const;

export type DashboardTab = (typeof DASHBOARD_TABS)[number]["id"];

export function parseTab(value: string | undefined, isOfficer = false): DashboardTab {
  const tab = DASHBOARD_TABS.find((t) => t.id === value);
  return tab && (isOfficer || !tab.officerOnly) ? tab.id : "overview";
}
