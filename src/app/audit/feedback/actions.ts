"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_BUCKET,
  FEEDBACK_MAX_FILES,
  FEEDBACK_MAX_FILE_BYTES,
  FEEDBACK_SUBJECT_MAX,
  isAllowedFeedbackMime,
} from "@/lib/feedback-constants";

export type FeedbackAttachmentInput = { path: string; name: string; type: string; size: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Saves a feedback message whose files the browser already uploaded to
 * feedback-files/{userId}/{feedbackId}/ (files go straight to storage because
 * a server action body is capped well below 10 MB). Each declared file is
 * re-checked against what actually landed in storage, so a made-up size or
 * path can't get through; the insert itself is one transaction (submit_feedback).
 */
export async function submitFeedback(input: {
  id: string;
  subject: string;
  body: string;
  attachments: FeedbackAttachmentInput[];
}): Promise<{ error?: string }> {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();

  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!UUID.test(input.id)) return { error: "Something went wrong - please reload the page and try again." };
  if (!subject) return { error: "Enter a subject." };
  if (subject.length > FEEDBACK_SUBJECT_MAX) return { error: `The subject can be at most ${FEEDBACK_SUBJECT_MAX} characters.` };
  if (!body) return { error: "Write your message." };
  if (body.length > FEEDBACK_BODY_MAX) return { error: `The message can be at most ${FEEDBACK_BODY_MAX} characters.` };
  if (input.attachments.length > FEEDBACK_MAX_FILES) return { error: `You can attach at most ${FEEDBACK_MAX_FILES} files.` };

  const folder = `${user.id}/${input.id}`;
  if (input.attachments.length > 0) {
    const { data: stored, error: listError } = await supabase.storage.from(FEEDBACK_BUCKET).list(folder);
    if (listError) return { error: "Could not check your attachments - please try again." };
    const storedByName = new Map((stored ?? []).map((f) => [f.name, f]));

    for (const a of input.attachments) {
      const name = a.path.startsWith(`${folder}/`) ? a.path.slice(folder.length + 1) : null;
      const file = name && !name.includes("/") ? storedByName.get(name) : undefined;
      if (!file) return { error: `"${a.name}" did not finish uploading - please attach it again.` };
      const size = Number(file.metadata?.size ?? 0);
      if (!isAllowedFeedbackMime(a.type)) return { error: `"${a.name}" is not a photo, PDF or video.` };
      if (size < 1 || size > FEEDBACK_MAX_FILE_BYTES) return { error: `"${a.name}" is larger than 10 MB.` };
      a.size = size;
    }
  }

  const { error } = await supabase.rpc("submit_feedback", {
    p_id: input.id,
    p_subject: subject,
    p_body: body,
    p_attachments: input.attachments,
  });
  // A repeat of a send that already went through (same id) is not a failure.
  if (error && error.code !== "23505") return { error: "Could not send your feedback - please try again." };

  revalidatePath("/audit/feedback");
  revalidatePath("/admin/feedbacks");
  return {};
}

/** Clears the "new reply" marker once the sender has opened their thread. */
export async function markRepliesSeen(feedbackId: string): Promise<void> {
  await requireRole("branch_admin");
  if (!UUID.test(feedbackId)) return;
  const supabase = await createClient();
  await supabase.rpc("mark_feedback_replies_seen", { p_feedback_id: feedbackId });
  revalidatePath("/audit/feedback");
}
