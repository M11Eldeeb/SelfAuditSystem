"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getRejectedClaimsAccess } from "@/lib/rejected-claims-server";
import { isAllowedFeedbackMime } from "@/lib/feedback-constants";
import {
  REJECTED_BUCKET,
  REJECTED_COMMENT_MAX,
  REJECTED_MAX_FILES,
  REJECTED_MAX_FILE_BYTES,
  REJECTED_REASON_MAX,
  normalizeWorkOrder,
} from "@/lib/rejected-claims";

export type RejectedAttachmentInput = { path: string; name: string; type: string; size: number };
type Result = { id?: string; error?: string; existingId?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function diaryUser(): Promise<{ user: CurrentUser } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };
  const access = await getRejectedClaimsAccess(user);
  if (access === "locked") return { error: "The Rejected Claims Diary is coming soon for branch admins." };
  if (access !== "full") return { error: "You do not have access to the Rejected Claims Diary." };
  return { user };
}

/**
 * Re-checks the files the browser says it uploaded against what is really in
 * storage (existence and size), so a made-up path or size cannot get through.
 */
async function verifyAttachments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  folder: string,
  attachments: RejectedAttachmentInput[]
): Promise<string | null> {
  if (attachments.length > REJECTED_MAX_FILES) return `You can attach at most ${REJECTED_MAX_FILES} files.`;
  if (attachments.length === 0) return null;
  const { data: stored, error } = await supabase.storage.from(REJECTED_BUCKET).list(folder);
  if (error) return "Could not check your attachments - please try again.";
  const byName = new Map((stored ?? []).map((f) => [f.name, f]));
  for (const a of attachments) {
    const name = a.path.startsWith(`${folder}/`) ? a.path.slice(folder.length + 1) : null;
    const file = name && !name.includes("/") ? byName.get(name) : undefined;
    if (!file) return `"${a.name}" did not finish uploading - please attach it again.`;
    const size = Number(file.metadata?.size ?? 0);
    if (!isAllowedFeedbackMime(a.type)) return `"${a.name}" is not a photo, PDF or video.`;
    if (size < 1 || size > REJECTED_MAX_FILE_BYTES) return `"${a.name}" is larger than 10 MB.`;
    a.size = size;
  }
  return null;
}

function revalidateDiary(entryId?: string) {
  revalidatePath("/admin/rejected-claims");
  revalidatePath("/audit/rejected-claims");
  if (entryId) {
    revalidatePath(`/admin/rejected-claims/${entryId}`);
    revalidatePath(`/audit/rejected-claims/${entryId}`);
  }
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
  attachments: RejectedAttachmentInput[];
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

  const fileError = await verifyAttachments(supabase, `${branchId}/${input.id}`, input.attachments);
  if (fileError) return { error: fileError };

  const { error } = await supabase.rpc("add_rejected_claim", {
    p_id: input.id,
    p_branch_id: branchId,
    p_work_order: workOrder,
    p_claim_no: claimNo || null,
    p_date: input.date,
    p_reason: reason,
    p_attachments: input.attachments,
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
  attachments: RejectedAttachmentInput[];
}): Promise<Result> {
  const who = await diaryUser();
  if ("error" in who) return { error: who.error };
  const supabase = await createClient();

  if (!UUID.test(input.id) || !UUID.test(input.entryId)) return { error: "Something went wrong - please reload the page and try again." };
  const body = input.body.trim();
  if (!body) return { error: "Write your comment." };
  if (body.length > REJECTED_COMMENT_MAX) return { error: `A comment can be at most ${REJECTED_COMMENT_MAX} characters.` };

  const { data: entry } = await supabase.from("self_audit_rejected_claims").select("id, branch_id").eq("id", input.entryId).maybeSingle();
  if (!entry) return { error: "This entry was not found." };

  const fileError = await verifyAttachments(supabase, `${entry.branch_id}/${entry.id}`, input.attachments);
  if (fileError) return { error: fileError };

  const { error } = await supabase.rpc("add_rejected_claim_comment", {
    p_id: input.id,
    p_entry_id: input.entryId,
    p_body: body,
    p_attachments: input.attachments,
  });
  if (error && error.code !== "23505") return { error: "Could not save your comment - please try again." };

  revalidateDiary(input.entryId);
  return { id: input.id };
}
