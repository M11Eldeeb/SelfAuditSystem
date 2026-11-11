"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAnyRole, requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DocsError, getDocsConnection, startDocsUpload } from "@/lib/documents/drive-docs";
import { cleanStagingFolder, driveFileInfo, ensureStagingFolder, ensureTechnicianFolder, ensureWipSubFolder, knownStagingFolder, moveDriveFile, relocateClaimFolder, renameDriveFile, trashDriveFile } from "@/lib/tech-claims/drive";
import type { Database } from "@/lib/supabase/types";

const PATHS = ["/technician", "/audit/technician-claims", "/admin/technician-claims", "/reviewer/technician-claims"];
const revalidateAll = () => PATHS.forEach((p) => revalidatePath(p));

const MAX_FILES = 40;
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const ALLOWED = /^(image\/|video\/|application\/pdf$)/;

export type FileMeta = { name: string; type: string; size: number };
export type ClaimFields = { vin: string; workOrder: string; endOfRepair: string; notes: string };

const safeName = (n: string) => n.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 200) || "file";

/**
 * Checks the claim's fields. A draft (Save) only needs the work order (it names the Drive folder); the VIN and end of
 * repair may still be empty. Sending needs everything.
 */
function cleanFields(
  f: ClaimFields,
  draft: boolean,
  branchCode: string
): { error: string } | { vin: string | null; workOrder: string; endOfRepair: string | null; notes: string | null } {
  const vin = f.vin.replace(/\s+/g, "").toUpperCase();
  // The technician types the number only; the branch code goes in front (e.g. HER-123456).
  const digits = f.workOrder.replace(/\D/g, "");
  if (!digits || digits.length > 20) return { error: "Enter the work order number." };
  const workOrder = branchCode ? `${branchCode}-${digits}` : digits;
  if (vin && (vin.length < 5 || vin.length > 30)) return { error: "Enter the VIN." };
  // The end of repair is not asked any more (older claims keep theirs).
  const end = f.endOfRepair ? Date.parse(f.endOfRepair) : NaN;
  if (end > Date.now() + 24 * 3_600_000) return { error: "The end of repair cannot be in the future." };
  return { vin: vin || null, workOrder, endOfRepair: Number.isNaN(end) ? null : new Date(end).toISOString(), notes: f.notes.trim().slice(0, 2000) || null };
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

const MIME_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "video/mp4": "mp4", "video/quicktime": "mov", "application/pdf": "pdf" };

/** A technician's evidence file is named after the work order plus a counter, e.g. HER-12345_001.jpg (the extension is kept). */
function evidenceName(workOrder: string, n: number, originalName: string, mimeType: string): string {
  const ext = originalName.match(/\.([A-Za-z0-9]{1,8})$/)?.[1]?.toLowerCase() ?? MIME_EXT[mimeType] ?? "";
  return `${workOrder}_${String(n).padStart(3, "0")}${ext ? `.${ext}` : ""}`;
}

/** The highest counter already used by this claim's files (0 when none), so new files carry on after it. */
async function lastFileCounter(claimId: string, workOrder: string): Promise<number> {
  const { data } = await createAdminClient().from("self_audit_tech_claim_files").select("file_name").eq("claim_id", claimId);
  const prefix = `${workOrder}_`;
  let max = 0;
  for (const f of data ?? []) {
    const m = f.file_name.startsWith(prefix) ? f.file_name.slice(prefix.length).match(/^(\d+)/) : null;
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** The work order changed: files named after the old one take the new one (counter and extension unchanged). */
async function renameClaimFiles(claimId: string, oldWorkOrder: string, newWorkOrder: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin.from("self_audit_tech_claim_files").select("id, drive_file_id, file_name").eq("claim_id", claimId);
  const prefix = `${oldWorkOrder}_`;
  for (const f of (data ?? []).filter((x) => x.file_name.startsWith(prefix))) {
    const name = `${newWorkOrder}_${f.file_name.slice(prefix.length)}`;
    await renameDriveFile(f.drive_file_id, name);
    await admin.from("self_audit_tech_claim_files").update({ file_name: name }).eq("id", f.id);
  }
}

/** The work order of a claim changed: its folder follows (moved to the new WIP's folder, or renamed for older claims). */
async function moveClaimFolder(claim: { drive_folder_id: string | null; claim_no: string; branch_id: string }, workOrder: string, branchName: string) {
  if (!claim.drive_folder_id) return;
  await relocateClaimFolder({ folderId: claim.drive_folder_id, claimNo: claim.claim_no, branchId: claim.branch_id, branchName, workOrder }).catch(() => undefined);
}

const techLabel = (name: string, employeeNo: string | null) => (employeeNo ? `${name} - ${employeeNo}` : name);

/** The signed-in technician, his branch name and his Drive staging folder. */
async function technicianContext() {
  const tech = await requireRole("technician");
  if (!tech.branch_id) throw new DocsError("Your account has no branch.");
  const [connection, { data: branch }, known] = await Promise.all([
    getDocsConnection(),
    createAdminClient().from("self_audit_branches").select("name, code").eq("id", tech.branch_id).maybeSingle(),
    knownStagingFolder(tech.branch_id, tech.id),
  ]);
  if (!connection) throw new DocsError("Google Drive is not connected yet - tell the warranty officer.");
  const name = tech.full_name ?? tech.email;
  const place = { branchId: tech.branch_id, branchName: branch?.name ?? "Branch", technicianId: tech.id, technicianLabel: techLabel(name, tech.employee_no) };
  const staging = known ?? (await ensureStagingFolder(place));
  return { tech, name, place, staging, branchCode: branch?.code ?? "" };
}

/**
 * Technician: one upload session for a file just added to the form. Files go to his staging folder straight away -
 * while he is still filling in the claim - so pressing Submit only has to move them (see submitTechClaim).
 */
export async function prepareStagedUpload(file: FileMeta): Promise<{ session?: string; error?: string }> {
  const bad = checkFiles([file]);
  if (bad) return { error: bad };
  try {
    // Fast path: the staging folder remembered from earlier (no Drive checks). If Google refuses the upload into it
    // (folder deleted in Drive), find or make it again and retry once.
    const ctx = await technicianContext();
    const staging = ctx.staging;
    let session: string;
    try {
      [session] = await openSessions(staging, [file]);
    } catch {
      await createAdminClient().from("self_audit_drive_folders").delete().eq("key", `tc:stage:${ctx.place.branchId}:${ctx.place.technicianId}`);
      [session] = await openSessions(await ensureStagingFolder(ctx.place), [file]);
    }
    // Now and then, clear files abandoned in this staging folder for more than two days.
    if (Math.random() < 0.1) after(() => cleanStagingFolder(staging).catch(() => undefined));
    return { session };
  } catch (e) {
    return { error: e instanceof DocsError ? e.message : "Could not reach Google Drive - please try again." };
  }
}

/** Technician: a file removed from the form before submitting goes to the Drive trash. */
export async function discardStagedFile(driveFileId: string): Promise<{ error?: string }> {
  try {
    const { staging } = await technicianContext();
    const info = await driveFileInfo(driveFileId);
    if (info && info.parents.includes(staging)) await trashDriveFile(driveFileId);
    return {};
  } catch (e) {
    return { error: e instanceof DocsError ? e.message : "Could not reach Google Drive." };
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

/**
 * Technician presses Submit: the claim is created (or, for a returned / unsent claim, corrected), its uploaded files are
 * moved from the staging folder into Warranty Documents / Branch / <WIP> / <claim no.> (a move - instant; the WIP folder
 * is shared with the WIP's QC, rejected claim and inquiry folders), recorded, and the claim goes to the branch's warranty
 * admin.
 */
export async function submitTechClaim(fields: ClaimFields, stagedIds: string[], claimId?: string, send = true): Promise<{ claimId?: string; error?: string }> {
  const admin = createAdminClient();
  try {
    const ctx = await technicianContext();
    const clean = cleanFields(fields, !send, ctx.branchCode);
    if ("error" in clean) return clean;
    const ids = [...new Set(stagedIds)].slice(0, MAX_FILES);

    // The claim: a new one, or the technician's own one he may still change.
    let claim: Database["public"]["Tables"]["self_audit_tech_claims"]["Row"];
    if (claimId) {
      const own = await ownEditableClaim(claimId);
      if ("error" in own) return { error: own.error };
      claim = own.claim;
    } else {
      if (send && !ids.length) return { error: "Add at least one photo, video or PDF." };
      const { data, error } = await admin
        .from("self_audit_tech_claims")
        .insert({ branch_id: ctx.place.branchId, technician_id: ctx.tech.id, technician_name: ctx.name, vin: clean.vin, work_order: clean.workOrder, end_of_repair: clean.endOfRepair, notes: clean.notes })
        .select("*")
        .single();
      if (error || !data) return { error: error?.message ?? "Could not save the claim." };
      // The folder is named after the claim number, which the database just gave it.
      try {
        const folderId = await ensureWipSubFolder({ branchId: ctx.place.branchId, branchName: ctx.place.branchName, wip: clean.workOrder, sub: data.claim_no, key: `tc:claim:${data.id}` });
        await admin.from("self_audit_tech_claims").update({ drive_folder_id: folderId }).eq("id", data.id);
        claim = { ...data, drive_folder_id: folderId };
      } catch (e) {
        await admin.from("self_audit_tech_claims").delete().eq("id", data.id);
        throw e;
      }
    }
    const folder = claim.drive_folder_id;
    if (!folder) return { error: "The claim's Drive folder is missing." };

    // A corrected work order renames the files already on the claim (HER-111_001.jpg -> HER-222_001.jpg).
    if (claimId && clean.workOrder !== claim.work_order) await renameClaimFiles(claim.id, claim.work_order, clean.workOrder).catch(() => undefined);

    // Move the staged files in (only files that really are in this technician's staging folder), each renamed after the
    // work order plus a counter that carries on after the files the claim already has.
    const infos = await Promise.all(ids.map((id) => driveFileInfo(id)));
    const staged = infos.filter((f): f is NonNullable<typeof f> => !!f && !f.trashed && f.parents.includes(ctx.staging));
    let counter = await lastFileCounter(claim.id, clean.workOrder);
    const named = staged.map((f) => ({ ...f, newName: evidenceName(clean.workOrder, ++counter, f.name, f.mimeType) }));
    await Promise.all(named.map((f) => moveDriveFile(f.id, ctx.staging, folder, f.newName)));
    if (named.length) {
      const { error } = await admin
        .from("self_audit_tech_claim_files")
        .insert(named.map((f) => ({ claim_id: claim.id, drive_file_id: f.id, file_name: f.newName, mime_type: f.mimeType, size_bytes: f.size, uploaded_by: ctx.tech.id })));
      if (error) return { claimId: claim.id, error: error.message };
    }
    // Save (draft): the claim and its files are kept, nothing goes to the warranty admin yet.
    if (!send) {
      if (claimId && clean.workOrder !== claim.work_order) await moveClaimFolder(claim, clean.workOrder, ctx.place.branchName);
      const { error } = await admin
        .from("self_audit_tech_claims")
        .update({ vin: clean.vin, work_order: clean.workOrder, end_of_repair: clean.endOfRepair, notes: clean.notes, updated_at: new Date().toISOString() })
        .eq("id", claim.id);
      if (error) return { claimId: claim.id, error: error.message };
      revalidateAll();
      return { claimId: claim.id };
    }

    const { count } = await admin.from("self_audit_tech_claim_files").select("id", { count: "exact", head: true }).eq("claim_id", claim.id);
    if (!count) return { claimId: claim.id, error: "No file reached Google Drive - please add the files again." };

    const edited =
      !!claimId &&
      (clean.vin !== claim.vin || clean.workOrder !== claim.work_order || clean.endOfRepair !== (claim.end_of_repair ? new Date(claim.end_of_repair).toISOString() : null) || clean.notes !== claim.notes);
    if (claimId && clean.workOrder !== claim.work_order) await moveClaimFolder(claim, clean.workOrder, ctx.place.branchName);
    const resubmit = claim.status === "returned";
    const now = new Date().toISOString();
    const { error } = await admin
      .from("self_audit_tech_claims")
      .update({ vin: clean.vin, work_order: clean.workOrder, end_of_repair: clean.endOfRepair, notes: clean.notes, status: "submitted", submitted_at: now, updated_at: now, times_submitted: claim.times_submitted + 1 })
      .eq("id", claim.id)
      .in("status", ["uploading", "returned"]);
    if (error) return { claimId: claim.id, error: error.message };
    await admin.from("self_audit_tech_claim_events").insert({
      claim_id: claim.id,
      kind: resubmit ? "resubmitted" : "submitted",
      body: resubmit && edited ? "Details corrected." : null,
      author_id: ctx.tech.id,
      author_name: ctx.name,
    });
    revalidateAll();
    return { claimId: claim.id };
  } catch (e) {
    return { error: e instanceof DocsError ? e.message : "Could not reach Google Drive - please try again." };
  }
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

/** The branch's warranty admin or claims reviewer (or a warranty officer): approve, return to the technician, or reject. */
export async function reviewTechClaim(claimId: string, decision: ReviewDecision, comment: string): Promise<{ error?: string }> {
  const user = await requireAnyRole(["branch_admin", "claims_reviewer", "officer"]);
  const text = comment.trim().slice(0, 2000);
  if (decision !== "approve" && !text) return { error: decision === "return" ? "Write what the technician must correct." : "Write the reason for the rejection." };
  const admin = createAdminClient();
  const { data: claim } = await admin.from("self_audit_tech_claims").select("id, branch_id, status").eq("id", claimId).maybeSingle();
  if (!claim || (user.role !== "officer" && claim.branch_id !== user.branch_id)) return { error: "Claim not found." };
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

/** A claim the signed-in warranty admin / claims reviewer (or officer) may act on - never a view-only account. */
async function reviewableClaim(claimId: string) {
  const user = await requireAnyRole(["branch_admin", "claims_reviewer", "officer"]);
  if (user.viewOnly) return { error: "View only." as const };
  const { data: claim } = await createAdminClient().from("self_audit_tech_claims").select("*").eq("id", claimId).maybeSingle();
  if (!claim || (user.role !== "officer" && claim.branch_id !== user.branch_id)) return { error: "Claim not found." as const };
  return { user, claim };
}

/** Warranty admin: upload sessions for files added to a claim the technician already sent (straight into its Drive folder). */
export async function prepareAdminClaimUploads(claimId: string, files: FileMeta[]): Promise<{ sessions?: string[]; error?: string }> {
  const r = await reviewableClaim(claimId);
  if ("error" in r) return { error: r.error };
  if (r.claim.status === "uploading") return { error: "The technician has not sent this claim yet." };
  if (!r.claim.drive_folder_id) return { error: "The claim's Drive folder is missing." };
  const { count } = await createAdminClient().from("self_audit_tech_claim_files").select("id", { count: "exact", head: true }).eq("claim_id", claimId);
  const bad = checkFiles(files, count ?? 0);
  if (bad) return { error: bad };
  try {
    return { sessions: await openSessions(r.claim.drive_folder_id, files) };
  } catch (e) {
    return { error: e instanceof DocsError ? e.message : "Could not reach Google Drive - please try again." };
  }
}

/** Warranty admin: records the files just uploaded (each checked in Drive: it must be in the claim's folder). */
export async function registerAdminClaimFiles(claimId: string, driveIds: string[]): Promise<{ added?: number; error?: string }> {
  const r = await reviewableClaim(claimId);
  if ("error" in r) return { error: r.error };
  const folder = r.claim.drive_folder_id;
  if (!folder) return { error: "The claim's Drive folder is missing." };
  const admin = createAdminClient();
  try {
    const infos = await Promise.all([...new Set(driveIds)].slice(0, MAX_FILES).map((id) => driveFileInfo(id)));
    const rows = infos
      .filter((f): f is NonNullable<typeof f> => !!f && !f.trashed && f.parents.includes(folder))
      .map((f) => ({ claim_id: claimId, drive_file_id: f.id, file_name: f.name.slice(0, 300), mime_type: f.mimeType, size_bytes: f.size, uploaded_by: r.user.id }));
    if (!rows.length) return { error: "No file reached Google Drive - please try again." };
    const { error } = await admin.from("self_audit_tech_claim_files").insert(rows);
    if (error) return { error: error.message };
    await admin.from("self_audit_tech_claim_events").insert({
      claim_id: claimId,
      kind: "files_added",
      body: rows.map((f) => f.file_name).join(", ").slice(0, 2000),
      author_id: r.user.id,
      author_name: r.user.full_name ?? r.user.email,
    });
    revalidateAll();
    return { added: rows.length };
  } catch (e) {
    return { error: e instanceof DocsError ? e.message : "Could not reach Google Drive." };
  }
}

/** The branch's technicians (for "Return to another technician"). */
export async function branchTechnicians(claimId: string): Promise<{ technicians?: { id: string; name: string }[]; error?: string }> {
  const r = await reviewableClaim(claimId);
  if ("error" in r) return { error: r.error };
  const { data } = await createAdminClient().from("self_audit_users").select("id, full_name, email, employee_no").eq("role", "technician").eq("branch_id", r.claim.branch_id).order("full_name");
  return {
    technicians: (data ?? [])
      .filter((t) => t.id !== r.claim.technician_id)
      .map((t) => ({ id: t.id, name: `${t.full_name ?? t.email}${t.employee_no ? ` - ${t.employee_no}` : ""}` })),
  };
}

/**
 * Warranty admin: returns a claim waiting for review to another technician of the same branch - it becomes his
 * (Returned, to correct and send again) and its Drive folder moves under his name.
 */
export async function reassignTechClaim(claimId: string, technicianId: string, comment: string): Promise<{ error?: string }> {
  const r = await reviewableClaim(claimId);
  if ("error" in r) return { error: r.error };
  const { user, claim } = r;
  if (claim.status !== "submitted" && claim.status !== "returned") return { error: "Only a claim waiting for review (or returned) can go to another technician." };
  const text = comment.trim().slice(0, 2000);
  if (!text) return { error: "Write what the technician must do." };
  const admin = createAdminClient();
  const [{ data: tech }, { data: branch }] = await Promise.all([
    admin.from("self_audit_users").select("id, full_name, email, employee_no, role, branch_id").eq("id", technicianId).maybeSingle(),
    admin.from("self_audit_branches").select("name").eq("id", claim.branch_id).maybeSingle(),
  ]);
  if (!tech || tech.role !== "technician" || tech.branch_id !== claim.branch_id) return { error: "Choose a technician of this branch." };
  if (tech.id === claim.technician_id) return { error: "The claim is already with this technician." };
  const techName = tech.full_name ?? tech.email;
  // An older claim (Warranty Documents / Branch / Technician / Work order) moves under the new technician. A newer one
  // sits in its WIP's folder, which does not depend on the technician - it stays.
  if (claim.drive_folder_id) {
    try {
      const info = await driveFileInfo(claim.drive_folder_id);
      const { data: oldTech } = await admin.from("self_audit_drive_folders").select("drive_id").eq("key", `tc:tech:${claim.branch_id}:${claim.technician_id}`).maybeSingle();
      if (info && info.parents[0] && oldTech && info.parents.includes(oldTech.drive_id)) {
        const newTechFolder = await ensureTechnicianFolder({ branchId: claim.branch_id, branchName: branch?.name ?? "Branch", technicianId: tech.id, technicianLabel: techLabel(techName, tech.employee_no) });
        if (!info.parents.includes(newTechFolder)) await moveDriveFile(claim.drive_folder_id, info.parents[0], newTechFolder);
      }
    } catch {
      // The claim still moves; the folder just stays where it was.
    }
  }
  const now = new Date().toISOString();
  const name = user.full_name ?? user.email;
  const { data: updated, error } = await admin
    .from("self_audit_tech_claims")
    .update({ technician_id: tech.id, technician_name: techName, status: "returned", review_comment: text, reviewed_by: user.id, reviewed_by_name: name, reviewed_at: now, updated_at: now })
    .eq("id", claimId)
    .in("status", ["submitted", "returned"])
    .select("id");
  if (error) return { error: error.message };
  if (!updated?.length) return { error: "The claim changed just now - reload the page." };
  await admin.from("self_audit_tech_claim_events").insert({ claim_id: claimId, kind: "reassigned", body: `From ${claim.technician_name} to ${techName}: ${text}`.slice(0, 2000), author_id: user.id, author_name: name });
  revalidateAll();
  return {};
}

/** Technician: his claims with this work order number (for "Add evidence"). The branch code is added in front. */
export async function findMyClaimsByWorkOrder(digits: string): Promise<{ claims?: { id: string; claimNo: string; workOrder: string; status: string; submittedAt: string | null }[]; error?: string }> {
  const tech = await requireRole("technician");
  const n = digits.replace(/\D/g, "");
  if (!n) return { error: "Enter the work order number." };
  const admin = createAdminClient();
  const { data: branch } = await admin.from("self_audit_branches").select("code").eq("id", tech.branch_id ?? "00000000-0000-0000-0000-000000000000").maybeSingle();
  const wo = branch?.code ? `${branch.code}-${n}` : n;
  const { data } = await admin
    .from("self_audit_tech_claims")
    .select("id, claim_no, work_order, status, submitted_at")
    .eq("technician_id", tech.id)
    .in("work_order", [...new Set([wo, n])])
    .neq("status", "uploading")
    .order("created_at", { ascending: false });
  return { claims: (data ?? []).map((c) => ({ id: c.id, claimNo: c.claim_no, workOrder: c.work_order, status: c.status, submittedAt: c.submitted_at })) };
}

/**
 * Technician: more evidence for a claim he already sent (any status but a draft). The staged files move into the
 * claim's work order folder and the history says "Files added" - the claim's status stays as it is.
 */
export async function addTechClaimEvidence(claimId: string, stagedIds: string[]): Promise<{ claimId?: string; error?: string }> {
  const admin = createAdminClient();
  try {
    const ctx = await technicianContext();
    const { data: claim } = await admin.from("self_audit_tech_claims").select("id, technician_id, status, drive_folder_id").eq("id", claimId).maybeSingle();
    if (!claim || claim.technician_id !== ctx.tech.id) return { error: "Claim not found." };
    if (claim.status === "uploading") return { error: "This claim was not sent yet - open it from My claims." };
    if (!claim.drive_folder_id) return { error: "The claim's Drive folder is missing." };
    const { count } = await admin.from("self_audit_tech_claim_files").select("id", { count: "exact", head: true }).eq("claim_id", claimId);
    const ids = [...new Set(stagedIds)].slice(0, Math.max(0, MAX_FILES - (count ?? 0)));
    if (!ids.length) return { error: count && count >= MAX_FILES ? `Up to ${MAX_FILES} files per claim.` : "Add at least one photo, video or PDF." };
    const infos = await Promise.all(ids.map((id) => driveFileInfo(id)));
    const staged = infos.filter((f): f is NonNullable<typeof f> => !!f && !f.trashed && f.parents.includes(ctx.staging));
    if (!staged.length) return { error: "No file reached Google Drive - please add the files again." };
    await Promise.all(staged.map((f) => moveDriveFile(f.id, ctx.staging, claim.drive_folder_id!)));
    const { error } = await admin
      .from("self_audit_tech_claim_files")
      .insert(staged.map((f) => ({ claim_id: claimId, drive_file_id: f.id, file_name: f.name.slice(0, 300), mime_type: f.mimeType, size_bytes: f.size, uploaded_by: ctx.tech.id })));
    if (error) return { error: error.message };
    await admin.from("self_audit_tech_claim_events").insert({ claim_id: claimId, kind: "files_added", body: `Additional evidence: ${staged.map((f) => f.name).join(", ")}`.slice(0, 2000), author_id: ctx.tech.id, author_name: ctx.name });
    revalidateAll();
    return { claimId };
  } catch (e) {
    return { error: e instanceof DocsError ? e.message : "Could not reach Google Drive - please try again." };
  }
}

/** Warranty admin / claims reviewer / officer: label the claim "Prior approval" (or take the label off) - nothing else changes. */
export async function setTechClaimPriorApproval(claimId: string, on: boolean): Promise<{ error?: string }> {
  const r = await reviewableClaim(claimId);
  if ("error" in r) return { error: r.error };
  const admin = createAdminClient();
  const { error } = await admin.from("self_audit_tech_claims").update({ prior_approval: on, updated_at: new Date().toISOString() }).eq("id", claimId);
  if (error) return { error: error.message };
  revalidateAll();
  return {};
}

/** The phone could not stamp or send a file: keep the reason (and the phone's browser) for the warranty team. Never throws. */
export async function reportUploadProblem(input: { name: string; type: string; size: number; message: string }): Promise<void> {
  try {
    const tech = await requireRole("technician");
    const ua = (await headers()).get("user-agent");
    await createAdminClient()
      .from("self_audit_tech_upload_problems")
      .insert({
        technician_id: tech.id,
        file_name: String(input.name).slice(0, 300),
        file_type: String(input.type).slice(0, 100),
        file_size: Number.isFinite(input.size) ? Math.round(input.size) : null,
        message: String(input.message).slice(0, 2000) || "?",
        user_agent: ua?.slice(0, 500) ?? null,
      });
  } catch {
    // a failed report must not disturb the technician
  }
}
