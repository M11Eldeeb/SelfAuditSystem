"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type SaveReviewState = { error?: string } | undefined;

export async function saveReview(
  assignmentId: string,
  cycleId: string,
  branchId: string,
  _prev: SaveReviewState,
  formData: FormData
): Promise<SaveReviewState> {
  const officer = await requireRole("officer");
  const supabase = await createClient();

  const { data: questions } = await supabase.from("audit_questions").select("id").eq("scope", "claim");
  const { data: existingReviews } = await supabase
    .from("ai_reviews")
    .select("question_id, ai_suggested_value")
    .eq("assignment_id", assignmentId);

  const aiSuggestionByQuestion = new Map((existingReviews ?? []).map((r) => [r.question_id, r.ai_suggested_value]));

  const rows = (questions ?? [])
    .map((q) => {
      const officerValue = formData.get(`officer_${q.id}`);
      if (!officerValue) return null;
      const aiSuggested = aiSuggestionByQuestion.get(q.id) ?? null;
      let decision: "confirmed" | "overridden" | null = null;
      if (aiSuggested) {
        decision = aiSuggested === String(officerValue) ? "confirmed" : "overridden";
      }
      return {
        assignment_id: assignmentId,
        question_id: q.id,
        officer_value: String(officerValue),
        officer_decision: decision,
        reviewed_by: officer.id,
        reviewed_at: new Date().toISOString(),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const missing = (questions ?? []).length - rows.length;
  if (missing > 0) {
    return { error: `Judge all ${questions?.length ?? 0} questions before saving (${missing} missing).` };
  }

  const { error } = await supabase.from("ai_reviews").upsert(rows, { onConflict: "assignment_id,question_id" });
  if (error) return { error: error.message };

  await supabase
    .from("audit_assignments")
    .update({ status: "reviewed", reviewed_by: officer.id, reviewed_at: new Date().toISOString() })
    .eq("id", assignmentId);

  revalidatePath(`/admin/review/${cycleId}/${branchId}`);
  redirect(`/admin/review/${cycleId}/${branchId}`);
}
