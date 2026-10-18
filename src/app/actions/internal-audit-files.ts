"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DriveError,
  createFileWithBytes,
  ensureInternalAuditFolder,
  getDriveStatus,
  getFileMeta,
  replaceFileBytes,
  startResumableUpload,
  trashFile,
} from "@/lib/google-drive";
import { loadInternalAuditReport } from "@/lib/internal-audit-report-data";
import { buildInternalAuditPdf, internalAuditPdfName } from "@/lib/internal-audit-pdf";

const NOT_CONNECTED = "Google Drive is not connected yet - connect it from the Rejected Claims Diary settings first.";
const IA_MAX_FILE_BYTES = 50 * 1024 * 1024;
const IA_MAX_FILES = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Photos, videos, PDFs and office files (sheets, documents, slides, CSV). */
function allowedMime(type: string): boolean {
  return (
    /^(image|video)\//.test(type) ||
    type === "application/pdf" ||
    type === "text/csv" ||
    /^application\/(vnd\.openxmlformats-officedocument\.|vnd\.ms-excel|msword|vnd\.ms-powerpoint)/.test(type)
  );
}

const safeDriveName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 180) || "file";
const driveMessage = (e: unknown) => (e instanceof DriveError ? e.message : "Could not reach Google Drive - please try again.");

/** "10-2026" from the audit's date (audit date, else end of its period, else when it was created). */
function monthLabelOf(audit: { audit_date: string | null; date_to: string | null; created_at: string }): string {
  const iso = audit.audit_date ?? audit.date_to ?? audit.created_at;
  return `${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
}

async function auditFolder(auditId: string): Promise<{ folderId: string } | { error: string }> {
  if (!UUID.test(auditId)) return { error: "Audit not found." };
  const supabase = await createClient();
  const { data: audit } = await supabase
    .from("self_audit_internal_audits")
    .select("id, branch_id, audit_date, date_to, created_at")
    .eq("id", auditId)
    .maybeSingle();
  if (!audit?.branch_id) return { error: "Audit not found." };
  if (!(await getDriveStatus())) return { error: NOT_CONNECTED };
  const { data: branch } = await supabase.from("self_audit_branches").select("name").eq("id", audit.branch_id).maybeSingle();
  try {
    return { folderId: await ensureInternalAuditFolder(audit.branch_id, branch?.name ?? "Branch", monthLabelOf(audit)) };
  } catch (e) {
    return { error: driveMessage(e) };
  }
}

/** Step 1: opens one Drive upload session per file in Internal Audit / <branch> / <MM-YYYY>; the browser sends the bytes to Google. */
export async function prepareInternalAuditUploads(input: {
  auditId: string;
  files: { name: string; type: string; size: number }[];
}): Promise<{ uploads?: { sessionUrl: string }[]; error?: string }> {
  await requireRole("officer");
  if (input.files.length === 0) return { error: "Choose a file first." };
  if (input.files.length > IA_MAX_FILES) return { error: `Upload at most ${IA_MAX_FILES} files at a time.` };
  for (const f of input.files) {
    if (!allowedMime(f.type)) return { error: `"${f.name}" is not a photo, video, PDF or office file.` };
    if (!(f.size >= 1) || f.size > IA_MAX_FILE_BYTES) return { error: `"${f.name}" must be under 50 MB.` };
  }
  const folder = await auditFolder(input.auditId);
  if ("error" in folder) return { error: folder.error };
  const origin = (await headers()).get("origin");
  if (!origin) return { error: "Something went wrong - please reload the page and try again." };
  try {
    const uploads = await Promise.all(
      input.files.map(async (f) => ({
        sessionUrl: await startResumableUpload({ parentId: folder.folderId, name: safeDriveName(f.name), mimeType: f.type, size: f.size, origin }),
      }))
    );
    return { uploads };
  } catch (e) {
    return { error: driveMessage(e) };
  }
}

/** Step 2: records the uploaded files after checking each one with Google (exists, in this audit's folder, sane size and type). */
export async function saveInternalAuditFiles(input: { auditId: string; driveFileIds: string[] }): Promise<{ error?: string }> {
  const officer = await requireRole("officer");
  const folder = await auditFolder(input.auditId);
  if ("error" in folder) return { error: folder.error };
  try {
    const metas = await Promise.all([...new Set(input.driveFileIds)].map((id) => getFileMeta(id)));
    const rows = [];
    for (const meta of metas) {
      if (!meta || meta.trashed || !meta.parents.includes(folder.folderId)) return { error: "A file did not finish uploading - please upload it again." };
      if (!allowedMime(meta.mimeType) || meta.size < 1 || meta.size > IA_MAX_FILE_BYTES) return { error: `"${meta.name}" is not an allowed file.` };
      rows.push({
        internal_audit_id: input.auditId,
        kind: "attachment" as const,
        drive_file_id: meta.id,
        drive_url: meta.webViewLink,
        file_name: meta.name,
        mime_type: meta.mimeType,
        size_bytes: meta.size,
        uploaded_by: officer.id,
      });
    }
    const supabase = await createClient();
    const { error } = await supabase.from("self_audit_internal_audit_files").insert(rows);
    if (error) return { error: error.message };
  } catch (e) {
    return { error: driveMessage(e) };
  }
  revalidatePath(`/admin/internal-audit/${input.auditId}`, "layout");
  return {};
}

/** Removes a file: Drive trash (recoverable 30 days) and the website's list. */
export async function deleteInternalAuditFile(fileId: string): Promise<{ error?: string }> {
  await requireRole("officer");
  const supabase = await createClient();
  const { data: file } = await supabase.from("self_audit_internal_audit_files").select("id, internal_audit_id, drive_file_id").eq("id", fileId).maybeSingle();
  if (!file) return { error: "File not found." };
  try {
    await trashFile(file.drive_file_id);
  } catch (e) {
    return { error: driveMessage(e) };
  }
  await supabase.from("self_audit_internal_audit_files").delete().eq("id", fileId);
  revalidatePath(`/admin/internal-audit/${file.internal_audit_id}`, "layout");
  return {};
}

/**
 * Saves the finalized audit's result PDF (the same one "Download PDF" makes)
 * to its Drive month folder; running it again replaces the content in place.
 * Called automatically when an audit is finalized, and by the report page's
 * button (e.g. if Drive was not connected at the time).
 */
export async function uploadInternalAuditReportToDrive(auditId: string): Promise<{ error?: string; url?: string | null }> {
  const officer = await requireRole("officer");
  const folder = await auditFolder(auditId);
  if ("error" in folder) return { error: folder.error };
  const admin = createAdminClient();
  const report = await loadInternalAuditReport(admin, auditId);
  if (!report) return { error: "Only a finalized audit has a result to upload." };

  const bytes = new Uint8Array(buildInternalAuditPdf(report.pdf).output("arraybuffer"));
  const name = internalAuditPdfName(report.pdf);
  try {
    const { data: existing } = await admin
      .from("self_audit_internal_audit_files")
      .select("id, drive_file_id")
      .eq("internal_audit_id", auditId)
      .eq("kind", "report")
      .maybeSingle();
    let fileId = existing?.drive_file_id ?? null;
    if (!fileId || !(await replaceFileBytes(fileId, "application/pdf", bytes))) {
      fileId = await createFileWithBytes({ parentId: folder.folderId, name, mimeType: "application/pdf", bytes });
    }
    const meta = await getFileMeta(fileId);
    const row = {
      internal_audit_id: auditId,
      kind: "report" as const,
      drive_file_id: fileId,
      drive_url: meta?.webViewLink ?? null,
      file_name: name,
      mime_type: "application/pdf",
      size_bytes: bytes.byteLength,
      uploaded_by: officer.id,
      created_at: new Date().toISOString(),
    };
    const { error } = existing
      ? await admin.from("self_audit_internal_audit_files").update(row).eq("id", existing.id)
      : await admin.from("self_audit_internal_audit_files").insert(row);
    if (error) return { error: error.message };
    revalidatePath(`/admin/internal-audit/${auditId}`, "layout");
    return { url: row.drive_url };
  } catch (e) {
    return { error: driveMessage(e) };
  }
}
