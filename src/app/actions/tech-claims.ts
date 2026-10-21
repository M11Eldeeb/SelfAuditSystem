"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAnyRole, requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DocsError, getDocsConnection, startDocsUpload } from "@/lib/documents/drive-docs";
import { driveFileInfo, ensureClaimFolder, renameDriveItem, trashDriveFile } from "@/lib/tech-claims/drive";

const PATHS = ["/technician", "/audit/technician-claims", "/admin/technician-claims"];
const revalidateAll = () => PATHS.forEach((p) => revalidatePath(p));

const MAX_FILES = 40;
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const ALLOWED = /^(image\/|video\/|application\/pdf$)/;

export type FileMeta = { name: string; type: string; size: number };
export type ClaimFields = { vin: string; workOrder: string; endOfRepair: string; notes: string };

const safeName = (n: string) => n.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 200) || "file";

function cleanFields(f: ClaimFields): { error: string } | { vin: string; workOrder: string; endOfRepair: string; notes: string | null } {
  const vin = f.vin.replace(/\s+/g, "").toUpperCase();
  const workOrder = f.workOrder.trim();
  if (vin.length < 5 || vin.length > 30) return { error: "Enter the VIN." };
  if (!workOrder || workOrder.length > 40) return { error: "Enter the work order number." };
  const end = Date.parse(f.endOfRepair);
  if (!f.endOfRepair || Number.isNaN(end)) return { error: "Enter the end of repair date and time." };
  if (end > Date.now() + 24 * 3_600_000) return { error: "The end of repair cannot be in the future." };
  return { vin, workOrder, endOfRepair: new Date(end).toISOString(), notes: f.notes.trim().slice(0, 2000) || null };
}

function checkFiles(files: FileMeta[], already = 0): string | null {
  if (files.length + already > MAX_FILES) return `Up to ${MAX_FILES} files per claim.`;
  for (const f of files) {
    if (!(f.size > 0)) return `"${f.name}" is empty.`;
    if (f.size > MAX_FILE_BYTES) return `"${f.name}" is larger than 2 GB.`;
    if (!ALLOWED.test(f.type || "")) return `"${f.name}": only photos, videos and PDF files.`;
  }
  return null;
}

async function openSessions(folderId: string, files: FileMeta[]): Promise<string[]> {
  const origin = (await headers()).get("origin");
  if (!origin) throw new DocsError("Please reload the page and try again.");
  return Promise.all(files.map((f) => startDocsUpload({ parentId: folderId, name: safeName(f.name), mimeType: f.type, size: f.size, origin })));
}

const techLabel = (name: string, employeeNo: string | null) => (employeeNo ? `${name} - ${employeeNo}` : name);

/**
 * Technician: creates the claim (still "uploading"), its Drive folder and one upload session per file. The browser then
 * sends the files straight to Google and calls finishTechClaim.
 */
export async function startTechClaim(fields: ClaimFields, files: FileMeta[]): Promise<{ claimId?: string; sessions?: string[]; error?: string }> {
  const tech = await requireRole("technician");
  if (!tech.branch_id) return { error: "Your account has no branch." };
  const clean = cleanFields(fields);
  if ("error" in clean) return clean;
  if (!files.length) return { error: "Add at least one photo, video or PDF." };
  const bad = checkFiles(files);
  if (bad) return { error: bad };
  if (!(await getDocsConnection())) return { error: "Google Drive is not connected yet - tell the warranty officer." };

  const admin = createAdminClient();
  const { data: branch } = await admin.from("self_audit_branches").select("name").eq("id", tech.branch_id).maybeSingle();
  const name = tech.full_name ?? tech.email;
  try {
    const folderId = await ensureClaimFolder({
      branchId: tech.branch_id,
      branchName: branch?.name ?? "Branch",
      technicianId: tech.id,
      technicianLabel: techLabel(name, tech.employee_no),
      workOrder: clean.workOrder,
    });
    const { data: claim, error } = await admin
      .from("self_audit_tech_claims")
      .insert({ branch_id: tech.branch_id, technician_id: tech.id, technician_name: name, vin: clean.vin, work_order: clean.workOrder, end_of_repair: clean.endOfRepair, notes: clean.notes, drive_folder_id: folderId })
      .select("id")
      .single();
    if (error || !claim) return { error: error?.message ?? "Could not save the claim." };
    const sessions = await openSessions(folderId, files);
    return { claimId: claim.id, sessions };
  } catch (e) {
    return { error: e instanceof DocsError ? e.message : "Could not reach Google Drive - please try again." };
  }
}

/** The technician's own claim that he may still change: not sent yet (upload interrupted) or returned to him. */
async function ownEditableClaim(claimId: string) {
  const tech = await requireRole("technician");
  const { data: claim } = await createAdminClient().from("self_audit_tech_claims").select("*").eq("id", claimId).maybeSingle();
  if (!claim || claim.technician_id !== tech.id) return { error: "Claim not found." as const };
  if (claim.status !== "uploading" && claim.status !== "returned") return { error: "This claim can no longer be changed." as const };
  return { tech, claim };
}

/** Technician: more files for a claim not sent yet or returned (upload sessions into its folder). */
export async function addTechClaimFiles(claimId: string, files: FileMeta[]): Promise<{ sessions?: string[]; error?: string }> {
  const own = await ownEditableClaim(claimId);
  if ("error" in own) return { error: own.error };
  if (!files.length) return { sessions: [] };
  const { count } = await createAdminClient().from("self_audit_tech_claim_files").select("id", { count: "exact", head: true }).eq("claim_id", claimId);
  const bad = checkFiles(files, count ?? 0);
  if (bad) return { error: bad };
  if (!own.claim.drive_folder_id) return { error: "The claim's Drive folder is missing." };
  try {
    return { sessions: await openSessions(own.claim.drive_folder_id, files) };
  } catch (e) {
    return { error: e instanceof DocsError ? e.message : "Could not reach Google Drive - please try again." };
  }
}

/**
 * Technician: the files are in Drive - record them (each one checked in Drive: it must be in the claim's folder) and send
 * the claim to the branch's warranty admin. For a returned claim the fields may be corrected at the same time.
 */
export async function finishTechClaim(claimId: string, driveFileIds: string[], fields?: ClaimFields, submit = true): Promise<{ error?: string }> {
  const own = await ownEditableClaim(claimId);
  if ("error" in own) return { error: own.error };
  const { tech, claim } = own;
  const admin = createAdminClient();

  try {
    const infos = await Promise.all([...new Set(driveFileIds)].slice(0, MAX_FILES).map((id) => driveFileInfo(id)));
    const rows = infos
      .filter((f): f is NonNullable<typeof f> => !!f && !f.trashed && !!claim.drive_folder_id && f.parents.includes(claim.drive_folder_id))
      .map((f) => ({ claim_id: claimId, drive_file_id: f.id, file_name: f.name.slice(0, 300), mime_type: f.mimeType, size_bytes: f.size, uploaded_by: tech.id }));
    if (rows.length) {
      const { error } = await admin.from("self_audit_tech_claim_files").insert(rows);
      if (error) return { error: error.message };
    }
  } catch (e) {
    return { error: e instanceof DocsError ? e.message : "Could not reach Google Drive - please try again." };
  }

  // Some files did not make it: keep the ones that did, the claim stays with the technician.
  if (!submit) {
    revalidateAll();
    return {};
  }
  const { count } = await admin.from("self_audit_tech_claim_files").select("id", { count: "exact", head: true }).eq("claim_id", claimId);
  if (!count) return { error: "No file reached Google Drive - please add the files again." };

  const update: Record<string, unknown> = {};
  let edited = false;
  if (fields) {
    const clean = cleanFields(fields);
    if ("error" in clean) return clean;
    edited = clean.vin !== claim.vin || clean.workOrder !== claim.work_order || clean.endOfRepair !== new Date(claim.end_of_repair).toISOString() || clean.notes !== claim.notes;
    Object.assign(update, { vin: clean.vin, work_order: clean.workOrder, end_of_repair: clean.endOfRepair, notes: clean.notes });
    if (clean.workOrder !== claim.work_order && claim.drive_folder_id) await renameDriveItem(claim.drive_folder_id, clean.workOrder).catch(() => undefined);
  }
  const resubmit = claim.status === "returned";
  const now = new Date().toISOString();
  const { error } = await admin
    .from("self_audit_tech_claims")
    .update({ ...update, status: "submitted", submitted_at: now, updated_at: now, times_submitted: claim.times_submitted + 1 })
    .eq("id", claimId)
    .in("status", ["uploading", "returned"]);
  if (error) return { error: error.message };
  await admin.from("self_audit_tech_claim_events").insert({
    claim_id: claimId,
    kind: resubmit ? "resubmitted" : "submitted",
    body: resubmit && edited ? "Details corrected." : null,
    author_id: tech.id,
    author_name: tech.full_name ?? tech.email,
  });
  revalidateAll();
  return {};
}

/** Technician: removes a file from a claim not sent yet or returned (it goes to the Drive trash). */
export async function removeTechClaimFile(fileRowId: string): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { data: file } = await admin.from("self_audit_tech_claim_files").select("id, claim_id, drive_file_id").eq("id", fileRowId).maybeSingle();
  if (!file) return { error: "File not found." };
  const own = await ownEditableClaim(file.claim_id);
  if ("error" in own) return { error: own.error };
  try {
    await trashDriveFile(file.drive_file_id);
  } catch (e) {
    return { error: e instanceof DocsError ? e.message : "Could not reach Google Drive." };
  }
  await admin.from("self_audit_tech_claim_files").delete().eq("id", fileRowId);
  revalidateAll();
  return {};
}

/** Technician: drops a claim that was never sent (upload interrupted) - its files go to the Drive trash. */
export async function discardTechClaim(claimId: string): Promise<{ error?: string }> {
  const own = await ownEditableClaim(claimId);
  if ("error" in own) return { error: own.error };
  if (own.claim.status !== "uploading") return { error: "Only a claim that was not sent can be discarded." };
  const admin = createAdminClient();
  const { data: files } = await admin.from("self_audit_tech_claim_files").select("drive_file_id").eq("claim_id", claimId);
  await Promise.all((files ?? []).map((f) => trashDriveFile(f.drive_file_id).catch(() => undefined)));
  await admin.from("self_audit_tech_claims").delete().eq("id", claimId).eq("status", "uploading");
  revalidateAll();
  return {};
}

export type ReviewDecision = "approve" | "return" | "reject";

/** The branch's warranty admin (or a warranty officer): approve, return to the technician, or reject. */
export async function reviewTechClaim(claimId: string, decision: ReviewDecision, comment: string): Promise<{ error?: string }> {
  const user = await requireAnyRole(["branch_admin", "officer"]);
  const text = comment.trim().slice(0, 2000);
  if (decision !== "approve" && !text) return { error: decision === "return" ? "Write what the technician must correct." : "Write the reason for the rejection." };
  const admin = createAdminClient();
  const { data: claim } = await admin.from("self_audit_tech_claims").select("id, branch_id, status").eq("id", claimId).maybeSingle();
  if (!claim || (user.role === "branch_admin" && claim.branch_id !== user.branch_id)) return { error: "Claim not found." };
  if (claim.status !== "submitted") return { error: "This claim is not waiting for review." };
  const status = decision === "approve" ? "approved" : decision === "return" ? "returned" : "rejected";
  const now = new Date().toISOString();
  const name = user.full_name ?? user.email;
  const { data: updated, error } = await admin
    .from("self_audit_tech_claims")
    .update({ status, review_comment: text || null, reviewed_by: user.id, reviewed_by_name: name, reviewed_at: now, updated_at: now })
    .eq("id", claimId)
    .eq("status", "submitted")
    .select("id");
  if (error) return { error: error.message };
  if (!updated?.length) return { error: "Someone else reviewed this claim just now - reload the page." };
  await admin.from("self_audit_tech_claim_events").insert({ claim_id: claimId, kind: status === "approved" ? "approved" : status === "returned" ? "returned" : "rejected", body: text || null, author_id: user.id, author_name: name });
  revalidateAll();
  return {};
}
