"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { scoreAnswer, scorePct } from "@/lib/scoring";

export type FinalizeState = { error?: string; success?: string } | undefined;

export async function finalizeBranchAudit(
  cycleId: string,
  branchId: string,
  _prev: FinalizeState,
  _formData: FormData
): Promise<FinalizeState> {
  void _prev;
  void _formData;
  const officer = await requireRole("officer");
  const supabase = await createClient();

  const { data: assignments } = await supabase
    .from("audit_assignments")
    .select("*")
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId);

  if (!assignments || assignments.length === 0) {
    return { error: "No assignments found for this branch/cycle." };
  }
  if (assignments.some((a) => a.status !== "reviewed")) {
    return { error: "All claims must be reviewed before finalizing." };
  }

  const { data: opsProgress } = await supabase
    .from("branch_operation_progress")
    .select("status")
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId)
    .maybeSingle();
  if (!opsProgress || opsProgress.status !== "reviewed") {
    return { error: "The branch operation questionnaire must be reviewed before finalizing." };
  }

  const assignmentIds = assignments.map((a) => a.id);
  const [{ data: questions }, { data: reviews }, { data: opsAnswers }] = await Promise.all([
    supabase.from("audit_questions").select("*"),
    supabase.from("ai_reviews").select("*").in("assignment_id", assignmentIds),
    supabase.from("branch_operation_answers").select("*").eq("cycle_id", cycleId).eq("branch_id", branchId),
  ]);

  const questionById = new Map((questions ?? []).map((q) => [q.id, q]));

  const allScores: number[] = [];
  const perQuestionScores = new Map<string, number[]>();

  (reviews ?? []).forEach((r) => {
    const question = questionById.get(r.question_id);
    if (!question) return;
    const finalValue = r.officer_value ?? r.ai_suggested_value;
    const score = scoreAnswer(question, finalValue);
    allScores.push(score);
    const list = perQuestionScores.get(r.question_id) ?? [];
    list.push(score);
    perQuestionScores.set(r.question_id, list);
  });

  (opsAnswers ?? []).forEach((a) => {
    const question = questionById.get(a.question_id);
    if (!question) return;
    const finalValue = a.officer_value ?? a.answer_value;
    const score = scoreAnswer(question, finalValue);
    allScores.push(score);
    const list = perQuestionScores.get(a.question_id) ?? [];
    list.push(score);
    perQuestionScores.set(a.question_id, list);
  });

  const breakdown: Record<string, number> = {};
  perQuestionScores.forEach((scores, questionId) => {
    breakdown[questionId] = scorePct(scores);
  });

  const { error } = await supabase.from("audit_results").upsert(
    {
      cycle_id: cycleId,
      branch_id: branchId,
      score_pct: scorePct(allScores),
      per_question_breakdown: breakdown,
      finalized_by: officer.id,
      finalized_at: new Date().toISOString(),
    },
    { onConflict: "cycle_id,branch_id" }
  );

  if (error) return { error: error.message };

  revalidatePath(`/admin/review/${cycleId}/${branchId}`);
  revalidatePath("/admin/results");
  return { success: "Results finalized." };
}
