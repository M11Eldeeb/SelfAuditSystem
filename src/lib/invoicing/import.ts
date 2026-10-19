import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchLatestReport, getInvoicingConnection, InvoicingError } from "./gmail-reader";
import { parseInvoicingReport } from "./parse";

export type ImportResult =
  | { status: "imported"; fileName: string; receivedAt: string; laborLines: number; partLines: number }
  | { status: "unchanged"; receivedAt: string | null }
  | { status: "not-found" }
  | { status: "not-connected" }
  | { status: "error"; error: string };

/**
 * Looks for the newest daily report in the connected mailbox and, if it is new (or `force`), replaces the months it
 * covers. Used by the dashboard's Refresh button, the page itself when the data is stale, and the daily job.
 */
export async function importLatestInvoicingReport(opts: { force?: boolean; userId?: string | null } = {}): Promise<ImportResult> {
  if (!(await getInvoicingConnection())) return { status: "not-connected" };
  const admin = createAdminClient();
  const { data: last } = await admin.from("self_audit_invoicing_imports").select("gmail_message_id, received_at").order("imported_at", { ascending: false }).limit(1).maybeSingle();

  try {
    const report = await fetchLatestReport(opts.force ? null : last?.gmail_message_id);
    if (report === "unchanged") return { status: "unchanged", receivedAt: last?.received_at ?? null };
    if (!report) return { status: "not-found" };

    const parsed = await parseInvoicingReport(report.bytes);
    if (!parsed.rows.length) return { status: "error", error: "The report's labor and parts sheets are empty." };

    const { error: delError } = await admin.from("self_audit_invoicing_lines").delete().in("month", parsed.months);
    if (delError) return { status: "error", error: delError.message };
    for (let i = 0; i < parsed.rows.length; i += 1000) {
      const { error } = await admin.from("self_audit_invoicing_lines").insert(parsed.rows.slice(i, i + 1000));
      if (error) return { status: "error", error: error.message };
    }
    await admin.from("self_audit_invoicing_imports").insert({
      gmail_message_id: report.messageId,
      subject: report.subject.slice(0, 300),
      received_at: report.receivedAt,
      file_name: report.fileName.slice(0, 200),
      labor_lines: parsed.laborLines,
      part_lines: parsed.partLines,
      months: parsed.months,
      imported_by: opts.userId ?? null,
    });
    return { status: "imported", fileName: report.fileName, receivedAt: report.receivedAt, laborLines: parsed.laborLines, partLines: parsed.partLines };
  } catch (e) {
    return { status: "error", error: e instanceof InvoicingError || e instanceof Error ? e.message : "Import failed." };
  }
}
