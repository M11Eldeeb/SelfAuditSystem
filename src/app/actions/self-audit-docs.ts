"use server";

import { headers } from "next/headers";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DocsError, getDocsConnection, startDocsUpload } from "@/lib/documents/drive-docs";
import { claimDocsFolder, docFileName, opsDocsFolder } from "@/lib/self-audit-drive";

export type DocTarget = { kind: "claim"; assignmentId: string } | { kind: "ops"; cycleId: string };

const ALLOWED = /^(image\/|application\/pdf$)/;
const MAX_BYTES = 60 * 1024 * 1024;

/**
 * Branch admin: an upload session for one self audit document - the browser sends the file straight to Google Drive
 * (Self Audit Documents / month / branch / claim, or Branch operations). The form then saves the Drive file id.
 */
export async function prepareSelfAuditDocUpload(target: DocTarget, photoTypeId: string, file: { name: string; type: string; size: number }): Promise<{ session?: string; error?: string }> {
  const user = await requireRole("branch_admin");
  if (user.viewOnly) return { error: "View only." };
  if (!user.branch_id) return { error: "Your account has no branch." };
  if (!(file.size > 0) || file.size > MAX_BYTES) return { error: "The file must be under 60 MB." };
  if (!ALLOWED.test(file.type || "")) return { error: "Only photos and PDF files." };
  if (!(await getDocsConnection())) return { error: "Google Drive is not connected yet - tell the warranty officer." };
  const admin = createAdminClient();
  const { data: type } = await admin.from("self_audit_audit_photo_types").select("label").eq("id", photoTypeId).maybeSingle();
  if (!type) return { error: "Unknown document type." };
  const origin = (await headers()).get("origin");
  if (!origin) return { error: "Please reload the page and try again." };
  try {
    let folder: string;
    if (target.kind === "claim") {
      const { data: a } = await admin.from("self_audit_audit_assignments").select("branch_id, status").eq("id", target.assignmentId).maybeSingle();
      if (!a || a.branch_id !== user.branch_id) return { error: "Claim not found." };
      if (a.status !== "not_started" && a.status !== "in_progress") return { error: "This claim was already submitted." };
      folder = await claimDocsFolder(target.assignmentId);
    } else {
      folder = await opsDocsFolder(target.cycleId, user.branch_id);
    }
    const ext = file.name.split(".").pop() ?? (file.type === "application/pdf" ? "pdf" : "jpg");
    const session = await startDocsUpload({ parentId: folder, name: docFileName(type.label, ext), mimeType: file.type, size: file.size, origin });
    return { session };
  } catch (e) {
    return { error: e instanceof DocsError ? e.message : "Could not reach Google Drive - please try again." };
  }
}
