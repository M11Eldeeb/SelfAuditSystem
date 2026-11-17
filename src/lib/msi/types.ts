// The shapes of a stored Major Service Indicators report (what lib/msi/parse.ts produces), importable by the browser code.
export type { SalesRow, MonthlyRow, MonthCell, DailyRow, KpiRow, KpiMonth, WholesaleRow, AdvisorRow, SaTargetRow, MsiMeta } from "./parse";
import type { MonthlyRow, DailyRow, KpiRow, SaTargetRow, SalesRow, AdvisorRow, WholesaleRow, MsiMeta } from "./parse";

export type MsiExtra = { monthly: MonthlyRow[]; daily: DailyRow[]; kpis: KpiRow[]; saTargets: SaTargetRow[] };

export type MsiReport = {
  reportDate: string;
  receivedAt: string | null;
  importedAt: string;
  subject: string | null;
  meta: MsiMeta;
  sales: SalesRow[];
  advisors: AdvisorRow[];
  wholesale: WholesaleRow[];
};
