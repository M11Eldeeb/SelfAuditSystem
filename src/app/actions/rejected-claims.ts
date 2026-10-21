"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { syncLogbook } from "@/lib/rejected-claims-logbook";
import { headers } from "next/headers";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRejectedClaimsAccess } from "@/lib/rejected-claims-server";
import { formatBytes, isAllowedFeedbackMime } from "@/lib/feedback-constants";
import {
  DriveError,
  ensureFolder,
  getDriveStatus,
  getFileMeta,
  startResumableUpload,
  syncDriveSharing,
} from "@/lib/google-drive";
import {
  REJECTED_COMMENT_MAX,
  REJECTED_INFO_MAX,
  REJECTED_LIST_ITEM_MAX,
  REJECTED_LIST_MAX_ITEMS,
  REJECTED_MAX_FILES,
  REJECTED_MAX_FILE_BYTES,
  REJECTED_REASON_MAX,
  nextDuplicateName,
  normalizeWorkOrder,
  type AttachmentKind,
} from "@/lib/rejected-claims";

/** A file the browser has already uploaded to Google Drive. */
export type DriveAttachmentInput = { driveFileId: string; name: string; type: string; size: number; kind?: AttachmentKind };
type Result = { id?: string; error?: string; existingId?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NOT_CONNECTED = "Google Drive is not connected yet - ask an officer to connect it.";

async function diaryUser(): Promise<{ user: CurrentUser } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };
  const access = await getRejectedClaimsAccess(user);
  if (access === "locked") return { error: "Rejected Claims From The Branch is coming soon for branch admins." };
  if (access !== "full") return { error: "You do not have access to Rejected Claims From The Branch." };
  return { user };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const driveMessage = (e: unknown) => (e instanceof DriveError ? e.message : "Could not reach Google Drive - please try again.");
const safeDriveName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 180) || "file";

function revalidateDiary(entryId?: string) {
  revalidatePath("/admin/rejected-claims");
  revalidatePath("/audit/rejected-claims");
  if (entryId) {
    revalidatePath(`/admin/rejected-claims/${entryId}`);
    revalidatePath(`/audit/rejected-claims/${entryId}`);
  }
}

function checkFiles(files: { name: string; type: string; size: number }[]): string | null {
  if (files.length === 0) return "Choose a file first.";
  if (files.length > REJECTED_MAX_FILES) return `You can attach at most ${REJECTED_MAX_FILES} files.`;
  for (const f of files) {
    if (!isAllowedFeedbackMime(f.type)) return `"${f.name}" is not a photo, PDF or video.`;
    if (!(f.size >= 1) || f.size > REJECTED_MAX_FILE_BYTES) return `"${f.name}" must be between 1 byte and ${formatBytes(REJECTED_MAX_FILE_BYTES)}.`;
  }
  return null;
}

/**
 * Step 1 of attaching files: makes sure the Drive folders exist
 * (Rejected Claims From Workshop / <branch> / <work order>) and opens one upload
 * session per file. The browser then sends each file straight to Google - a
 * server action body is far too small for 20 MB. For a new entry pass the branch
 * and work order typed; for an existing entry only its id.
 */
export async function prepareDriveUploads(input: {
  entryId: string;
  branchId?: string;
  workOrder?: string;
  files: { name: string; type: string; size: number }[];
}): Promise<{ uploads?: { sessionUrl: string }[]; error?: string }> {
  const who = await diaryUser();
  if ("error" in who) return { error: who.error };
  const { user } = who;
  if (!UUID.test(input.entryId)) return { error: "Something went wrong - please reload the page and try again." };
  const fileError = checkFiles(input.files);
  if (fileError) return { error: fileError };

  const drive = await getDriveStatus();
  if (!drive) return { error: NOT_CONNECTED };

  const supabase = await createClient();
  let branchId: string;
  let workOrder: string;
  if (input.workOrder !== undefined) {
    // A new entry: the branch and work order come from the form.
    const candidate = user.role === "branch_admin" ? user.branch_id : input.branchId;
    if (!candidate || !UUID.test(candidate)) return { error: "Choose the branch first." };
    const { data: branch } = await supabase.from("self_audit_branches").select("id, code").eq("id", candidate).maybeSingle();
    if (!branch) return { error: "Branch not found." };
    const wo = normalizeWorkOrder(input.workOrder, branch.code);
    if (wo.value === undefined) return { error: `${wo.error} Enter the work order before attaching files.` };
    branchId = branch.id;
    workOrder = wo.value;
  } else {
    // An existing entry (adding a comment): read it as the caller, so access is checked.
    const { data: entry } = await supabase
      .from("self_audit_rejected_claims")
      .select("branch_id, work_order_no")
      .eq("id", input.entryId)
      .maybeSingle();
    if (!entry) return { error: "This entry was not found." };
    branchId = entry.branch_id;
    workOrder = entry.work_order_no;
  }

  const { data: branchRow } = await supabase.from("self_audit_branches").select("name").eq("id", branchId).maybeSingle();
  const origin = (await headers()).get("origin");
  if (!origin) return { error: "Something went wrong - please reload the page and try again." };

  try {
    const branchFolder = await ensureFolder(`branch:${branchId}`, branchRow?.name ?? "Branch", drive.rootFolderId);
    const entryFolder = await ensureFolder(`wo:${branchId}:${workOrder}`, workOrder, branchFolder);
    // One session per file, all at once (20 sequential round trips would be slow).
    const uploads = await Promise.all(
      input.files.map(async (f) => ({
        sessionUrl: await startResumableUpload({ parentId: entryFolder, name: safeDriveName(f.name), mimeType: f.type, size: f.size, origin }),
      }))
    );
    return { uploads };
  } catch (e) {
    return { error: driveMessage(e) };
  }
}

/**
 * Step 3: before saving, re-checks every file the browser says it uploaded
 * against Google itself - it exists, is not trashed, sits in this work order's
 * folder and is a sane size and type - so an invented id cannot get in.
 */
async function verifyDriveAttachments(branchId: string, workOrder: string, files: DriveAttachmentInput[]) {
  if (files.length === 0) return { rows: [] as { driveFileId: string; driveUrl: string | null; name: string; type: string; size: number; kind: AttachmentKind }[] };
  if (files.length > REJECTED_MAX_FILES) return { error: `You can attach at most ${REJECTED_MAX_FILES} files.` };
  if (!(await getDriveStatus())) return { error: NOT_CONNECTED };

  const { data: folder } = await createAdminClient().from("self_audit_drive_folders").select("drive_id").eq("key", `wo:${branchId}:${workOrder}`).maybeSingle();
  if (!folder) return { error: "The upload folder was not found - please attach the files again." };

  const rows = [];
  const unique = files.filter((f, i) => files.findIndex((g) => g.driveFileId === f.driveFileId) === i);
  try {
    // Ask Google about all the files at once.
    const metas = await Promise.all(unique.map((f) => getFileMeta(f.driveFileId)));
    for (let i = 0; i < unique.length; i++) {
      const f = unique[i];
      const meta = metas[i];
      if (!meta || meta.trashed || !meta.parents.includes(folder.drive_id)) return { error: `"${f.name}" did not finish uploading - please attach it again.` };
      if (!isAllowedFeedbackMime(meta.mimeType)) return { error: `"${meta.name}" is not a photo, PDF or video.` };
      if (meta.size < 1 || meta.size > REJECTED_MAX_FILE_BYTES) return { error: `"${meta.name}" is larger than ${formatBytes(REJECTED_MAX_FILE_BYTES)}.` };
      rows.push({ driveFileId: meta.id, driveUrl: meta.webViewLink, name: meta.name, type: meta.mimeType, size: meta.size, kind: (f.kind === "service_history" ? "service_history" : "file") as AttachmentKind });
    }
  } catch (e) {
    return { error: driveMessage(e) };
  }
  return { rows };
}

/**
 * Logs a rejected work order. A branch admin always logs for their own branch
 * (whatever the browser sends); an officer picks the branch. The work order is
 * normalised ("35698" -> "HER-35698"), and logging one that already exists
 * returns its id so the screen can open it instead of creating a duplicate.
 */
export async function createRejectedClaim(input: {
  id: string;
  branchId?: string;
  workOrder: string;
  /** Set when this is a repeat of an existing work order (the original's number); workOrder is then <original>-1, -2 ... */
  duplicateOf?: string;
  claimNo?: string;
  date: string;
  reason: string;
  /** Optional additional information; blank values are simply not stored. */
  customerName?: string;
  vehicleModel?: string;
  serviceAdvisor?: string;
  teamLeader?: string;
  labours?: string[];
  parts?: string[];
  attachments: DriveAttachmentInput[];
}): Promise<Result> {
  const who = await diaryUser();
  if ("error" in who) return { error: who.error };
  const { user } = who;
  const supabase = await createClient();

  if (!UUID.test(input.id)) return { error: "Something went wrong - please reload the page and try again." };
  const branchId = user.role === "branch_admin" ? user.branch_id : input.branchId;
  if (!branchId || !UUID.test(branchId)) return { error: "Choose the branch." };

  const { data: branch } = await supabase.from("self_audit_branches").select("id, code, active").eq("id", branchId).maybeSingle();
  if (!branch) return { error: "Branch not found." };

  const wo = normalizeWorkOrder(input.workOrder, branch.code);
  if (wo.value === undefined) return { error: wo.error };
  const workOrder = wo.value;

  // A repeat must be exactly <original>-<n>, and the original must exist in this branch.
  let duplicateOf: string | null = null;
  if (input.duplicateOf) {
    const base = normalizeWorkOrder(input.duplicateOf, branch.code);
    if (base.value === undefined) return { error: base.error };
    const shape = new RegExp("^" + escapeRegExp(base.value) + "-[1-9][0-9]*$");
    if (!shape.test(workOrder)) return { error: "Something went wrong with the repeat number - please try again." };
    const { data: original } = await supabase.from("self_audit_rejected_claims").select("id").eq("branch_id", branchId).eq("work_order_no", base.value).maybeSingle();
    if (!original) return { error: `${base.value} was not found in the diary.` };
    duplicateOf = base.value;
  }

  const claimNo = input.claimNo?.trim() ?? "";
  if (claimNo.length > 40) return { error: "The claim number is too long." };
  if (!DATE.test(input.date)) return { error: "Choose the rejection date." };
  const reason = input.reason.trim();
  if (!reason) return { error: "Write the reason for the rejection." };
  if (reason.length > REJECTED_REASON_MAX) return { error: `The reason can be at most ${REJECTED_REASON_MAX} characters.` };

  const info = {
    customerName: input.customerName?.trim() ?? "",
    vehicleModel: input.vehicleModel?.trim() ?? "",
    serviceAdvisor: input.serviceAdvisor?.trim() ?? "",
    teamLeader: input.teamLeader?.trim() ?? "",
  };
  for (const [label, value] of [
    ["customer name", info.customerName],
    ["vehicle model", info.vehicleModel],
    ["service advisor name", info.serviceAdvisor],
    ["team leader name", info.teamLeader],
  ]) {
    if (value.length > REJECTED_INFO_MAX) return { error: `The ${label} can be at most ${REJECTED_INFO_MAX} characters.` };
  }
  const cleanList = (list: string[] | undefined) => (list ?? []).map((x) => String(x).trim()).filter(Boolean);
  const labours = cleanList(input.labours);
  const parts = cleanList(input.parts);
  if (labours.length > REJECTED_LIST_MAX_ITEMS || parts.length > REJECTED_LIST_MAX_ITEMS) {
    return { error: `You can list at most ${REJECTED_LIST_MAX_ITEMS} labours and ${REJECTED_LIST_MAX_ITEMS} parts.` };
  }
  if ([...labours, ...parts].some((x) => x.length > REJECTED_LIST_ITEM_MAX)) {
    return { error: `Each labour or part can be at most ${REJECTED_LIST_ITEM_MAX} characters.` };
  }

  const verified = await verifyDriveAttachments(branchId, workOrder, input.attachments);
  if ("error" in verified) return { error: verified.error };

  const { error } = await supabase.rpc("add_rejected_claim", {
    p_id: input.id,
    p_branch_id: branchId,
    p_work_order: workOrder,
    p_claim_no: claimNo || null,
    p_date: input.date,
    p_reason: reason,
    p_attachments: verified.rows,
    p_duplicate_of: duplicateOf,
    p_customer_name: info.customerName || null,
    p_vehicle_model: info.vehicleModel || null,
    p_service_advisor: info.serviceAdvisor || null,
    p_team_leader: info.teamLeader || null,
    p_labours: labours,
    p_parts: parts,
  });

  if (error) {
    if (error.code === "23505" && duplicateOf) {
      // Someone logged another repeat at the same moment and took this number.
      const { data: same } = await supabase.from("self_audit_rejected_claims").select("id").eq("id", input.id).maybeSingle();
      if (same) {
        revalidateDiary(input.id);
        return { id: input.id };
      }
      return { error: `Another repeat of ${duplicateOf} was just logged - please save again to get the next number.` };
    }
    if (error.code === "23505") {
      // Same id re-sent (the first attempt went through) or the work order is already logged.
      const { data: existing } = await supabase
        .from("self_audit_rejected_claims")
        .select("id")
        .or(`id.eq.${input.id},and(branch_id.eq.${branchId},work_order_no.eq.${workOrder})`)
        .limit(1)
        .maybeSingle();
      if (existing?.id === input.id) {
        revalidateDiary(input.id);
        return { id: input.id };
      }
      return { error: `${workOrder} is already in the diary.`, existingId: existing?.id };
    }
    if (error.message.includes("cannot be in the future")) return { error: "The rejection date cannot be in the future." };
    return { error: "Could not save the entry - please try again." };
  }

  revalidateDiary(input.id);
  // Once the response is out: write the logbook PDF to the work order's Drive folder,
  // and make sure the branch's folder is shared with its admins.
  after(async () => {
    await syncLogbook(input.id);
    await syncDriveSharing({ branchId }).catch(() => null);
    revalidateDiary(input.id);
  });
  return { id: input.id };
}

/** Adds a comment (and optional files) to an entry the caller can see. */
export async function addRejectedClaimComment(input: {
  id: string;
  entryId: string;
  body: string;
  attachments: DriveAttachmentInput[];
}): Promise<Result> {
  const who = await diaryUser();
  if ("error" in who) return { error: who.error };
  const supabase = await createClient();

  if (!UUID.test(input.id) || !UUID.test(input.entryId)) return { error: "Something went wrong - please reload the page and try again." };
  const body = input.body.trim();
  if (!body) return { error: "Write your comment." };
  if (body.length > REJECTED_COMMENT_MAX) return { error: `A comment can be at most ${REJECTED_COMMENT_MAX} characters.` };

  const { data: entry } = await supabase.from("self_audit_rejected_claims").select("id, branch_id, work_order_no").eq("id", input.entryId).maybeSingle();
  if (!entry) return { error: "This entry was not found." };

  const verified = await verifyDriveAttachments(entry.branch_id, entry.work_order_no, input.attachments);
  if ("error" in verified) return { error: verified.error };

  const { error } = await supabase.rpc("add_rejected_claim_comment", {
    p_id: input.id,
    p_entry_id: input.entryId,
    p_body: body,
    p_attachments: verified.rows,
  });
  if (error && error.code !== "23505") return { error: "Could not save your comment - please try again." };

  revalidateDiary(input.entryId);
  after(async () => {
    await syncLogbook(input.entryId);
    await syncDriveSharing({ branchId: entry.branch_id }).catch(() => null);
    revalidateDiary(input.entryId);
  });
  return { id: input.id };
}

/** Officer-only: writes an entry's logbook PDF to Drive again (missing, or out of date). */
export async function rebuildLogbook(entryId: string): Promise<{ error?: string }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "officer") return { error: "Only an officer can do this." };
  if (!UUID.test(entryId)) return { error: "Entry not found." };
  const result = await syncLogbook(entryId);
  if (!result.ok) return { error: result.error };
  revalidateDiary(entryId);
  return {};
}

export type WorkOrderCheck = {
  workOrder?: string;
  error?: string;
  /** Present when this work order is already in the diary. */
  duplicate?: { base: string; suggested: string; existingId: string; existingDate: string | null; existingBy: string | null };
};

/**
 * Asks whether a work order is already in the diary, before anything is
 * uploaded. If it is, returns what a repeat would be saved as (-1, -2, -3 ...) so
 * the screen can warn first and then use that name for the files and the entry.
 */
export async function checkWorkOrder(input: { branchId?: string; workOrder: string }): Promise<WorkOrderCheck> {
  const who = await diaryUser();
  if ("error" in who) return { error: who.error };
  const { user } = who;
  const supabase = await createClient();

  const branchId = user.role === "branch_admin" ? user.branch_id : input.branchId;
  if (!branchId || !UUID.test(branchId)) return { error: "Choose the branch." };
  const { data: branch } = await supabase.from("self_audit_branches").select("code").eq("id", branchId).maybeSingle();
  if (!branch) return { error: "Branch not found." };
  const wo = normalizeWorkOrder(input.workOrder, branch.code);
  if (wo.value === undefined) return { error: wo.error };

  const { data: existing } = await supabase
    .from("self_audit_rejected_claims")
    .select("id, rejection_date, created_by_name")
    .eq("branch_id", branchId)
    .eq("work_order_no", wo.value)
    .maybeSingle();
  if (!existing) return { workOrder: wo.value };

  const { data: repeats } = await supabase.from("self_audit_rejected_claims").select("work_order_no").eq("branch_id", branchId).like("work_order_no", `${wo.value}-%`);
  return {
    workOrder: wo.value,
    duplicate: {
      base: wo.value,
      suggested: nextDuplicateName(wo.value, (repeats ?? []).map((r) => r.work_order_no)),
      existingId: existing.id,
      existingDate: existing.rejection_date,
      existingBy: existing.created_by_name,
    },
  };
}
