import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchLatestMailSpreadsheet, getInvoicingConnection } from "@/lib/invoicing/gmail-reader";
import { JIAD_DEALER_CODE_SUFFIX_MAP } from "@/lib/parse-claims";
import { parseComplaintsReport, type ParsedComplaint } from "./parse";

/**
 * The monthly complaints file arrives by e-mail with a subject like "Complaints Tracker Report Oct-2026" (the month
 * changes, and the first word may be dropped: "Tracker Report Nov-2026"), so any subject with "Tracker Report" and an
 * Excel file counts. It is read from the same mailbox as the Warranty Invoicing report.
 */
const QUERY = `subject:("Tracker Report") has:attachment newer_than:70d`;
const SUBJECT = /tracker\s+report/i;

export type ComplaintsImportResult =
  | { status: "imported"; fileName: string; receivedAt: string; rows: number }
  | { status: "unchanged"; receivedAt: string | null }
  | { status: "not-found" }
  | { status: "not-connected" }
  | { status: "error"; error: string };

/** Saves parsed rows (upsert by key - the file is cumulative). Returns an error message, or null. */
export async function saveComplaints(rows: ParsedComplaint[]): Promise<string | null> {
  const admin = createAdminClient();
  const { data: branches } = await admin.from("self_audit_branches").select("id, code");
  const idByCode = new Map((branches ?? []).filter((b) => b.code).map((b) => [b.code!.toUpperCase(), b.id]));
  const now = new Date().toISOString();
  const full = rows.map((r) => ({ ...r, branch_id: r.dealer_code ? (idByCode.get(JIAD_DEALER_CODE_SUFFIX_MAP[r.dealer_code]) ?? null) : null, imported_at: now }));
  for (let i = 0; i < full.length; i += 1000) {
    const { error } = await admin.from("self_audit_complaints").upsert(full.slice(i, i + 1000), { onConflict: "key" });
    if (error) return error.message;
  }
  return null;
}

/** Imports the newest complaints e-mail if it is new (or `force`). Used by the Refresh button and the daily job. */
export async function importLatestComplaintsReport(opts: { force?: boolean; userId?: string | null } = {}): Promise<ComplaintsImportResult> {
  if (!(await getInvoicingConnection())) return { status: "not-connected" };
  const admin = createAdminClient();
  const { data: last } = await admin.from("self_audit_complaint_imports").select("gmail_message_id, received_at").order("imported_at", { ascending: false }).limit(1).maybeSingle();
  try {
    const mail = await fetchLatestMailSpreadsheet(QUERY, opts.force ? null : last?.gmail_message_id, (s) => SUBJECT.test(s));
    if (mail === "unchanged") return { status: "unchanged", receivedAt: last?.received_at ?? null };
    if (!mail) return { status: "not-found" };
    const rows = await parseComplaintsReport(mail.bytes);
    if (!rows.length) return { status: "error", error: `No complaints found in "${mail.fileName}" (expected a sheet with a "Complaint Category" column).` };
    const saved = await saveComplaints(rows);
    if (saved) return { status: "error", error: saved };
    await admin.from("self_audit_complaint_imports").insert({
      gmail_message_id: mail.messageId,
      subject: mail.subject.slice(0, 300),
      received_at: mail.receivedAt,
      file_name: mail.fileName.slice(0, 200),
      rows: rows.length,
      imported_by: opts.userId ?? null,
    });
    return { status: "imported", fileName: mail.fileName, receivedAt: mail.receivedAt, rows: rows.length };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : "Import failed." };
  }
}
