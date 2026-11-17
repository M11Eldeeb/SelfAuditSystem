import { createAdminClient } from "@/lib/supabase/admin";
import { importLatestMsiReport } from "@/lib/msi/import";
import { scopeReport, type MsiScope } from "@/lib/msi/scope";
import { MsiView } from "@/components/msi/msi-view";
import { displayFont } from "@/components/dashboard/font";
import type { MsiReport } from "@/lib/msi/types";
import type { MsiMeta, SalesRow, AdvisorRow, WholesaleRow } from "@/lib/msi/parse";

/** The Major Service Indicators page for any of its readers (the three parts of the site mount it under their own address). */
export async function MsiPageContent({ date, scope, basePath, canRefresh }: { date?: string; scope: NonNullable<MsiScope>; basePath: string; canRefresh: boolean }) {
  const admin = createAdminClient();
  const listDates = async () => (await admin.from("self_audit_msi_reports").select("report_date").order("report_date", { ascending: false }).limit(400)).data ?? [];
  let dates = await listDates();
  let importNote: string | null = null;
  // The first visit reads the newest e-mail when nothing is stored yet.
  if (!dates.length) {
    const r = await importLatestMsiReport();
    if (r.status === "not-connected") importNote = "The report mailbox is not connected yet (Warranty Invoicing connects it).";
    else if (r.status === "not-found") importNote = "No Major Service Indicators e-mail was found in the connected mailbox yet.";
    else if (r.status === "error") importNote = r.error;
    dates = await listDates();
  }
  const available = dates.map((d) => d.report_date);
  const chosen = date && available.includes(date) ? date : available[0];

  let report: MsiReport | null = null;
  if (chosen) {
    const { data } = await admin.from("self_audit_msi_reports").select("report_date, received_at, imported_at, subject, meta, sales, advisors, wholesale").eq("report_date", chosen).maybeSingle();
    if (data) {
      report = {
        reportDate: data.report_date,
        receivedAt: data.received_at,
        importedAt: data.imported_at,
        subject: data.subject,
        meta: data.meta as MsiMeta,
        sales: data.sales as SalesRow[],
        advisors: data.advisors as AdvisorRow[],
        wholesale: data.wholesale as WholesaleRow[],
      };
      if (!scope.all) report = scopeReport(report, scope.code);
    }
  }

  return (
    <div className={`${displayFont.variable} relative left-1/2 w-[min(96rem,calc(100vw-var(--sidebar-w,0px)-2rem))] -translate-x-1/2`}>
      <MsiView report={report} dates={available} isLatest={chosen === available[0]} canRefresh={canRefresh} importNote={importNote} basePath={basePath} branchName={scope.all ? null : scope.branchName} />
    </div>
  );
}
