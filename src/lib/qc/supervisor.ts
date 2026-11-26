import "server-only";
import type { CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// The quality supervisor's tools on the QC reports: the export log (PDF / Excel, so the list marks the reports exported
// already) and the comments on a report. Both tables are read and written by the server only.

export type QcExportMark = { at: string; by: string | null; format: "pdf" | "excel" };
export type QcComment = { id: string; author: string; role: string | null; body: string; at: string };

/** Only the quality supervisor's exports are logged (the "exported already" mark is his worklist). */
export async function recordQcExport(user: CurrentUser, checkIds: string[], format: "pdf" | "excel"): Promise<void> {
  if (user.role !== "quality_supervisor" || !checkIds.length) return;
  const name = user.full_name?.trim() || user.email;
  const rows = checkIds.map((id) => ({ check_id: id, user_id: user.id, user_name: name, format }));
  const admin = createAdminClient();
  for (let i = 0; i < rows.length; i += 500) await admin.from("self_audit_qc_exports").insert(rows.slice(i, i + 500));
}

/** The latest export of each QC (only the ones exported). */
export async function qcExportMarks(checkIds: string[]): Promise<Map<string, QcExportMark>> {
  const out = new Map<string, QcExportMark>();
  if (!checkIds.length) return out;
  const admin = createAdminClient();
  for (let i = 0; i < checkIds.length; i += 200) {
    const { data } = await admin.from("self_audit_qc_exports").select("check_id, user_name, format, exported_at").in("check_id", checkIds.slice(i, i + 200)).order("exported_at", { ascending: false });
    for (const r of data ?? []) if (!out.has(r.check_id)) out.set(r.check_id, { at: r.exported_at, by: r.user_name, format: r.format });
  }
  return out;
}

export async function listQcComments(checkId: string): Promise<QcComment[]> {
  const { data } = await createAdminClient().from("self_audit_qc_comments").select("id, author_name, author_role, body, created_at").eq("check_id", checkId).order("created_at");
  return (data ?? []).map((c) => ({ id: c.id, author: c.author_name ?? "—", role: c.author_role, body: c.body, at: c.created_at }));
}

/** Who may write a comment on a QC report: the quality supervisor and the warranty officers (not view-only copies). */
export const canCommentOnQc = (user: CurrentUser) => !user.viewOnly && (user.role === "quality_supervisor" || user.role === "officer");
