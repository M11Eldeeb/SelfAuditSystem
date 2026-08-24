"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type SaveBranchOpsReviewState = { error?: string } | undefined;

export async function saveBranchOpsReview(
  cycleId: string,
  branchId: string,
  _prev: SaveBranchOpsReviewState,
  formData: FormData
): Promise<SaveBranchOpsReviewState> {
  const officer = await requireRole("officer");
  const supabase = await createClient();

  const { data: questions } = await supabase
    .from("audit_questions")
    .select("id")
    .eq("scope", "branch");

  const rows = (questions ?? [])
    .map((q) => {
      const value = formData.get(`officer_${q.id}`);
      if (!value) return null;
      return { cycle_id: cycleId, branch_id: branchId, question_id: q.id, officer_value: String(value) };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length < (questions ?? []).length) {
    return { error: `Judge all ${questions?.length ?? 0} questions before saving.` };
  }

  const { error } = await supabase
    .from("branch_operation_answers")
    .upsert(rows, { onConflict: "cycle_id,branch_id,question_id" });
  if (error) return { error: error.message };

  const { error: progressError } = await supabase
    .from("branch_operation_progress")
    .update({ status: "reviewed", reviewed_by: officer.id, reviewed_at: new Date().toISOString() })
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId);
  if (progressError) return { error: progressError.message };

  revalidatePath(`/admin/review/${cycleId}/${branchId}`);
  redirect(`/admin/review/${cycleId}/${branchId}`);
}
