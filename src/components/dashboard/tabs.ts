export const DASHBOARD_TABS = [
  { id: "overview", label: "Overview", title: "Warranty KPI overview" },
  { id: "cycle", label: "Cycle Times & SLA", title: "Cycle times & SLA" },
  { id: "financials", label: "Claims & Financials", title: "Claims & financials" },
  { id: "warranty", label: "Warranty Room & Parts", title: "Warranty room & parts" },
] as const;

export type DashboardTab = (typeof DASHBOARD_TABS)[number]["id"];

export function parseTab(value: string | undefined): DashboardTab {
  return DASHBOARD_TABS.some((t) => t.id === value) ? (value as DashboardTab) : "overview";
}
