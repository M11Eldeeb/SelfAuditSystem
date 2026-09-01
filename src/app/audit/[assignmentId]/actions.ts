"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { runAiChecks } from "@/lib/ai-check";

export type SaveAuditState = { error?: string; success?: string } | undefined;

export async function saveAudit(
  assignmentId: string,
  _prev: SaveAuditState,
  formData: FormData
): Promise<SaveAuditState> {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();

  const { data: assignment } = await supabase
    .from("self_audit_audit_assignments")
    .select("*")
    .eq("id", assignmentId)
    .single();

  if (!assignment || assignment.branch_id !== user.branch_id) {
    return { error: "Audit not found." };
  }
  if (assignment.status !== "not_started" && assignment.status !== "in_progress") {
    return { error: "This audit has already been submitted and can no longer be edited." };
  }

  const [{ data: questions }, { data: photoTypes }, { data: existingAnswers }, { data: existingPhotos }] =
    await Promise.all([
      supabase.from("self_audit_audit_questions").select("*").eq("scope", "claim").order("sort_order"),
      supabase.from("self_audit_audit_photo_types").select("*").eq("scope", "claim").order("sort_order"),
      supabase.from("self_audit_audit_answers").select("*").eq("assignment_id", assignmentId),
      supabase.from("self_audit_audit_photos").select("*").eq("assignment_id", assignmentId),
    ]);

  const intent = String(formData.get("intent") ?? "draft");

  const answerRows = (questions ?? [])
    .map((q) => {
      const answerValue = formData.get(`answer_${q.id}`);
      const conditionalValue = formData.get(`conditional_${q.id}`);
      return {
        assignment_id: assignmentId,
        question_id: q.id,
        answer_value: answerValue ? String(answerValue) : null,
        conditional_value: conditionalValue ? String(conditionalValue) : null,
      };
    })
    .filter((r) => r.answer_value !== null);

  if (answerRows.length > 0) {
    const { error } = await supabase
      .from("self_audit_audit_answers")
      .upsert(answerRows, { onConflict: "assignment_id,question_id" });
    if (error) return { error: error.message };
  }

  const noteText = formData.get("note");
  if (noteText !== null) {
    await supabase
      .from("self_audit_audit_notes")
      .upsert(
        { assignment_id: assignmentId, note_text: String(noteText).trim() || null },
        { onConflict: "assignment_id" }
      );
  }

  // The file itself is already uploaded client-side (PhotoUploadField) straight to
  // Supabase Storage - Vercel hard-caps a serverless function's request body at
  // 4.5MB regardless of Next's bodySizeLimit config, which a scanned PDF or a
  // few phone photos can easily exceed. Only the resulting path arrives here.
  const uploadedPhotoTypeIds = new Set((existingPhotos ?? []).map((p) => p.photo_type_id));
  for (const pt of photoTypes ?? []) {
    const path = formData.get(`photo_path_${pt.id}`);
    if (typeof path === "string" && path.startsWith(`${assignmentId}/`)) {
      const { error: photoRowError } = await supabase
        .from("self_audit_audit_photos")
        .upsert(
          { assignment_id: assignmentId, photo_type_id: pt.id, storage_path: path },
          { onConflict: "assignment_id,photo_type_id" }
        );
      if (photoRowError) return { error: photoRowError.message };
      uploadedPhotoTypeIds.add(pt.id);
    }
  }

  let newStatus: "in_progress" | "submitted" = "in_progress";

  if (intent === "submit") {
    const finalAnswers = new Map<string, string | null>();
    (existingAnswers ?? []).forEach((a) => finalAnswers.set(a.question_id, a.answer_value));
    answerRows.forEach((a) => finalAnswers.set(a.question_id, a.answer_value));

    const missingQuestions = (questions ?? []).filter((q) => q.required && !finalAnswers.get(q.id));
    const missingPhotos = (photoTypes ?? []).filter((p) => p.required && !uploadedPhotoTypeIds.has(p.id));

    if (missingQuestions.length > 0 || missingPhotos.length > 0) {
      return {
        error: `Cannot submit yet - missing: ${[
          ...missingQuestions.map((q) => q.text),
          ...missingPhotos.map((p) => p.label),
        ].join("; ")}`,
      };
    }
    newStatus = "submitted";
  }

  await supabase
    .from("self_audit_audit_assignments")
    .update({
      status: newStatus,
      ...(newStatus === "submitted"
        ? { submitted_at: new Date().toISOString(), submitted_by: user.id }
        : {}),
    })
    .eq("id", assignmentId);

  revalidatePath(`/audit/${assignmentId}`);
  revalidatePath("/audit");

  if (newStatus === "submitted") {
    // Runs after the response is sent, so it doesn't block the branch admin's redirect,
    // while still keeping the serverless function alive until it finishes (see Next's `after`).
    after(() => runAiChecks(assignmentId).catch((err) => console.error("AI check failed", assignmentId, err)));
    redirect("/audit");
  }

  return { success: "Draft saved." };
}
