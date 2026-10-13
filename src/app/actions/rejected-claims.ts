"use server";

import { revalidatePath } from "next/cache";
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
  shareRootWithOfficers,
  startResumableUpload,
  type ShareResult,
} from "@/lib/google-drive";
import {
  REJECTED_COMMENT_MAX,
  REJECTED_MAX_FILES,
  REJECTED_MAX_FILE_BYTES,
  REJECTED_REASON_MAX,
  normalizeWorkOrder,
} from "@/lib/rejected-claims";

/** A file the browser has already uploaded to Google Drive. */
export type DriveAttachmentInput = { driveFileId: string; name: string; type: string; size: number };
type Result = { id?: string; error?: string; existingId?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NOT_CONNECTED = "Google Drive is not connected yet - ask an officer to connect it.";

async function diaryUser(): Promise<{ user: CurrentUser } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };
  const access = await getRejectedClaimsAccess(user);
  if (access === "locked") return { error: "The Rejected Claims Diary is coming soon for branch admins." };
  if (access !== "full") return { error: "You do not have access to the Rejected Claims Diary." };
  return { user };
}

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
  if (files.length === 0) return { rows: [] as { driveFileId: string; driveUrl: string | null; name: string; type: string; size: number }[] };
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
      rows.push({ driveFileId: meta.id, driveUrl: meta.webViewLink, name: meta.name, type: meta.mimeType, size: meta.size });
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
  claimNo?: string;
  date: string;
  reason: string;
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

  const claimNo = input.claimNo?.trim() ?? "";
  if (claimNo.length > 40) return { error: "The claim number is too long." };
  if (!DATE.test(input.date)) return { error: "Choose the rejection date." };
  const reason = input.reason.trim();
  if (!reason) return { error: "Write the reason for the rejection." };
  if (reason.length > REJECTED_REASON_MAX) return { error: `The reason can be at most ${REJECTED_REASON_MAX} characters.` };

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
  });

  if (error) {
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
  return { id: input.id };
}

/**
 * Gives every officer view access to the Drive folder (and so every branch's
 * files), skipping anyone who already has it. Run it whenever a new officer joins.
 */
export async function shareDriveWithOfficers(): Promise<{ error?: string; result?: ShareResult }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "officer") return { error: "Only an officer can do this." };
  try {
    const result = await shareRootWithOfficers();
    if (!result) return { error: NOT_CONNECTED };
    return { result };
  } catch (e) {
    return { error: driveMessage(e) };
  }
}
