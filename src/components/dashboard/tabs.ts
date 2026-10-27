export const DASHBOARD_TABS = [
  { id: "tasks", label: "Tasks", title: "Task tracking", officerOnly: false },
  { id: "overview", label: "Overview", title: "Warranty KPI overview", officerOnly: false },
  { id: "cycle", label: "Cycle Times & SLA", title: "Cycle times & SLA", officerOnly: false },
  { id: "financials", label: "Claims & Financials", title: "Claims & financials", officerOnly: false },
  { id: "warranty", label: "Warranty Room & Parts", title: "Warranty room & parts", officerOnly: false },
  { id: "trends", label: "Trends & Repeats", title: "Trends & repeat repairs", officerOnly: true },
  { id: "reconciliation", label: "Reconciliation", title: "Settlement reconciliation", officerOnly: true },
] as const;

export type DashboardTab = (typeof DASHBOARD_TABS)[number]["id"];

export function parseTab(value: string | undefined, isOfficer = false): DashboardTab {
  // Warranty Invoicing is part of Claims & Financials now (old links and the Gmail connect step still say "invoicing").
  if (value === "invoicing") value = "financials";
  // Prior Approvals lives inside Warranty Room & Parts now (its "Warranty" view).
  if (value === "prior") value = "warranty";
  const tab = DASHBOARD_TABS.find((t) => t.id === value);
  return tab && (isOfficer || !tab.officerOnly) ? tab.id : "overview";
}
