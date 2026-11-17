import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchLatestReport, getInvoicingConnection, InvoicingError } from "@/lib/invoicing/gmail-reader";
import { parseMsiReport } from "./parse";

export type MsiImportResult =
  | { status: "imported"; reportDate: string; fileName: string; receivedAt: string; notes: string[] }
  | { status: "unchanged"; reportDate: string | null }
  | { status: "not-found" }
  | { status: "not-connected" }
  | { status: "error"; error: string };

/**
 * Looks for the newest daily Major Service Indicators e-mail in the connected mailbox and, if it is new (or `force`), keeps its
 * figures under the report's own date. Used by the Refresh button, the page when the data is stale, and the morning job.
 */
export async function importLatestMsiReport(opts: { force?: boolean } = {}): Promise<MsiImportResult> {
  if (!(await getInvoicingConnection())) return { status: "not-connected" };
  const admin = createAdminClient();
  const { data: last } = await admin.from("self_audit_msi_reports").select("gmail_message_id, report_date").order("imported_at", { ascending: false }).limit(1).maybeSingle();
  try {
    const report = await fetchLatestReport(opts.force ? null : last?.gmail_message_id);
    if (report === "unchanged") return { status: "unchanged", reportDate: last?.report_date ?? null };
    if (!report) return { status: "not-found" };

    const parsed = await parseMsiReport(report.bytes);
    const { error } = await admin.from("self_audit_msi_reports").upsert({
      report_date: parsed.meta.runDate,
      gmail_message_id: report.messageId,
      subject: report.subject.slice(0, 300),
      file_name: report.fileName.slice(0, 200),
      received_at: report.receivedAt,
      imported_at: new Date().toISOString(),
      meta: parsed.meta,
      sales: parsed.sales,
      advisors: parsed.advisors,
      wholesale: parsed.wholesale,
      extra: parsed.extra,
    });
    if (error) return { status: "error", error: error.message };
    // The large extra part is kept for the newest report only.
    await admin.from("self_audit_msi_reports").update({ extra: null }).lt("report_date", parsed.meta.runDate);
    return { status: "imported", reportDate: parsed.meta.runDate, fileName: report.fileName, receivedAt: report.receivedAt, notes: parsed.notes };
  } catch (e) {
    return { status: "error", error: e instanceof InvoicingError || e instanceof Error ? e.message : "Import failed." };
  }
}
