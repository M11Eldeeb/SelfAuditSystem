import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchLatestReport, getInvoicingConnection, InvoicingError } from "./gmail-reader";
import { parseInvoicingReport } from "./parse";

/** Replaces the months in `parsed` (summary rows and every line). Returns an error message, or null. */
export async function saveParsed(parsed: Awaited<ReturnType<typeof parseInvoicingReport>>): Promise<string | null> {
  const admin = createAdminClient();
  for (const table of ["self_audit_invoicing_lines", "self_audit_invoicing_detail"] as const) {
    const { error } = await admin.from(table).delete().in("month", parsed.months);
    if (error) return error.message;
  }
  // ~35k rows a month: batches of 2,000 sent 6 at a time keep the import well inside the 60 s limit.
  const batches: (() => PromiseLike<{ error: { message: string } | null }>)[] = [];
  for (let i = 0; i < parsed.rows.length; i += 2000) {
    const chunk = parsed.rows.slice(i, i + 2000);
    batches.push(() => admin.from("self_audit_invoicing_lines").insert(chunk));
  }
  for (let i = 0; i < parsed.details.length; i += 2000) {
    const chunk = parsed.details.slice(i, i + 2000);
    batches.push(() => admin.from("self_audit_invoicing_detail").insert(chunk));
  }
  for (let i = 0; i < batches.length; i += 6) {
    const results = await Promise.all(batches.slice(i, i + 6).map((run) => run()));
    const failed = results.find((r) => r.error);
    if (failed?.error) return failed.error.message;
  }
  // Line detail is kept for the newest three months only (month totals stay forever).
  const newest = parsed.months[parsed.months.length - 1];
  if (newest) {
    const d = new Date(`${newest}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 2);
    await admin.from("self_audit_invoicing_detail").delete().lt("month", d.toISOString().slice(0, 10));
  }
  return null;
}

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

    const saved = await saveParsed(parsed);
    if (saved) return { status: "error", error: saved };
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
