"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FEEDBACK_BODY_MAX, FEEDBACK_BUCKET } from "@/lib/feedback-constants";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidateFeedbackPages(id?: string) {
  revalidatePath("/admin/feedbacks");
  if (id) revalidatePath(`/admin/feedbacks/${id}`);
  revalidatePath("/audit/feedback");
  if (id) revalidatePath(`/audit/feedback/${id}`);
}

/** Opening a message clears it from every officer's bell. */
export async function markFeedbackSeen(feedbackId: string): Promise<void> {
  await requireRole("officer");
  if (!UUID.test(feedbackId)) return;
  const supabase = await createClient();
  await supabase.rpc("mark_feedback_seen_by_officer", { p_feedback_id: feedbackId });
  revalidatePath("/admin/feedbacks");
}

/** Adds a reply the branch admin who sent the feedback can read. */
export async function replyToFeedback(feedbackId: string, text: string): Promise<{ error?: string }> {
  const officer = await requireRole("officer");
  if (!UUID.test(feedbackId)) return { error: "Message not found." };
  const body = text.trim();
  if (!body) return { error: "Write a reply first." };
  if (body.length > FEEDBACK_BODY_MAX) return { error: `A reply can be at most ${FEEDBACK_BODY_MAX} characters.` };

  const supabase = await createClient();
  const { data: exists } = await supabase.from("self_audit_feedback").select("id").eq("id", feedbackId).maybeSingle();
  if (!exists) return { error: "This message no longer exists." };

  const { error } = await supabase
    .from("self_audit_feedback_replies")
    .insert({ feedback_id: feedbackId, author_id: officer.id, body });
  if (error) return { error: "Could not send your reply - please try again." };

  // Replying implies the message was read, even if the open-page marker lagged.
  await supabase.rpc("mark_feedback_seen_by_officer", { p_feedback_id: feedbackId });

  revalidateFeedbackPages(feedbackId);
  return {};
}

/**
 * Deletes a message, its replies and its attachments (to free storage). The
 * files go first and must all be removed: if storage fails, the rows stay so
 * the message can be retried instead of leaving orphan files nobody can find.
 */
export async function deleteFeedback(feedbackId: string): Promise<{ error?: string }> {
  await requireRole("officer");
  if (!UUID.test(feedbackId)) return { error: "Message not found." };
  const supabase = await createClient();

  const { data: attachments, error: listError } = await supabase
    .from("self_audit_feedback_attachments")
    .select("storage_path")
    .eq("feedback_id", feedbackId);
  if (listError) return { error: "Could not read the attachments - please try again." };

  const paths = (attachments ?? []).map((a) => a.storage_path);
  if (paths.length > 0) {
    const { data: removed, error: removeError } = await supabase.storage.from(FEEDBACK_BUCKET).remove(paths);
    if (removeError) return { error: `Could not delete the attachments: ${removeError.message}` };
    if ((removed ?? []).length < paths.length) {
      return { error: `Only ${(removed ?? []).length} of ${paths.length} attachments were deleted - try again.` };
    }
  }

  const { error } = await supabase.from("self_audit_feedback").delete().eq("id", feedbackId);
  if (error) return { error: "Attachments were deleted, but the message could not be - please try again." };

  revalidateFeedbackPages(feedbackId);
  return {};
}
