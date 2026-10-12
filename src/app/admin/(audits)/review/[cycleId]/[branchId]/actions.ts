"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { scoreAnswer, scorePct } from "@/lib/scoring";

export type FinalizeState = { error?: string; success?: string } | undefined;
export type ReopenState = { error?: string } | undefined;

/**
 * Deadline passing auto-scores an unsubmitted claim at 0% (expire-assignments.ts)
 * so the app never silently stalls waiting on a branch that stopped
 * responding. But the officer may know the branch actually did the work late,
 * or just wants to give them a real shot at their rightful score instead of
 * a flat zero - this puts the assignment back in front of the branch admin
 * exactly as if the deadline hadn't passed. Only the assignment's status
 * changes; expire-assignments.ts never touched the branch admin's saved
 * answers (self_audit_audit_answers), so anything they'd already filled in
 * is still there. Blocked once the branch is finalized - reopening after
 * that would invalidate an already-recorded result with no re-finalize path
 * wired up yet.
 */
export async function reopenExpiredAssignment(
  cycleId: string,
  branchId: string,
  assignmentId: string
): Promise<ReopenState> {
  await requireRole("officer");
  const supabase = await createClient();

  const { data: existingResult } = await supabase
    .from("self_audit_audit_results")
    .select("id")
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId)
    .maybeSingle();
  if (existingResult) {
    return { error: "This branch's results are already finalized for this cycle." };
  }

  const { data: assignment } = await supabase
    .from("self_audit_audit_assignments")
    .select("id, status")
    .eq("id", assignmentId)
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId)
    .maybeSingle();
  if (!assignment) return { error: "Assignment not found." };
  if (assignment.status !== "expired") return { error: "Only an expired assignment can be reopened." };

  const { count: answerCount } = await supabase
    .from("self_audit_audit_answers")
    .select("question_id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId);

  const { error } = await supabase
    .from("self_audit_audit_assignments")
    .update({ status: (answerCount ?? 0) > 0 ? "in_progress" : "not_started" })
    .eq("id", assignmentId);
  if (error) return { error: error.message };

  revalidatePath(`/admin/review/${cycleId}/${branchId}`);
  revalidatePath("/audit");
  return {};
}

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
    .from("self_audit_audit_assignments")
    .select("*")
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId);

  if (!assignments || assignments.length === 0) {
    return { error: "No assignments found for this branch/cycle." };
  }
  // 'expired' claims were never submitted by the deadline, so there's
  // nothing for the officer to review - they're scored 0% automatically.
  if (assignments.some((a) => a.status !== "reviewed" && a.status !== "expired")) {
    return { error: "All claims must be reviewed before finalizing." };
  }

  const { data: opsProgress } = await supabase
    .from("self_audit_branch_operation_progress")
    .select("status")
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId)
    .maybeSingle();
  if (!opsProgress || opsProgress.status !== "reviewed") {
    return { error: "The branch operation questionnaire must be reviewed before finalizing." };
  }

  const assignmentIds = assignments.map((a) => a.id);
  const [{ data: questions }, { data: reviews }, { data: opsAnswers }] = await Promise.all([
    supabase.from("self_audit_audit_questions").select("*"),
    supabase.from("self_audit_ai_reviews").select("*").in("assignment_id", assignmentIds),
    supabase.from("self_audit_branch_operation_answers").select("*").eq("cycle_id", cycleId).eq("branch_id", branchId),
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

  const claimQuestionIds = (questions ?? []).filter((q) => q.scope === "claim").map((q) => q.id);
  assignments
    .filter((a) => a.status === "expired")
    .forEach(() => {
      claimQuestionIds.forEach((questionId) => {
        allScores.push(0);
        const list = perQuestionScores.get(questionId) ?? [];
        list.push(0);
        perQuestionScores.set(questionId, list);
      });
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

  const { error } = await supabase.from("self_audit_audit_results").upsert(
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
  revalidatePath("/admin/results/self-audit");
  revalidatePath(`/admin/results/self-audit/${branchId}`);
  return { success: "Results finalized." };
}

/**
 * Escape hatch for finalizeBranchAudit's normal gates (all claims reviewed,
 * branch ops reviewed) - an officer-only override for a branch that simply
 * never responded and isn't going to before the officer needs the result.
 * Every question without a real recorded answer scores 0%: claim questions
 * on an assignment that was never reviewed (not just 'expired'), and every
 * branch-ops question if there's no reviewed submission at all. Also flips
 * any non-terminal assignment to 'expired' and the ops progress row to
 * 'reviewed' (branch_ops_status has no 'expired' value) so the review page
 * reflects reality afterward, not a stuck "not submitted" state next to a
 * published score.
 */
export async function forceFinalizeBranchAudit(cycleId: string, branchId: string): Promise<FinalizeState> {
  const officer = await requireRole("officer");
  const supabase = await createClient();

  const { data: existingResult } = await supabase
    .from("self_audit_audit_results")
    .select("id")
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId)
    .maybeSingle();
  if (existingResult) return { error: "This branch's results are already finalized for this cycle." };

  const { data: assignments } = await supabase
    .from("self_audit_audit_assignments")
    .select("*")
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId);
  if (!assignments || assignments.length === 0) {
    return { error: "No assignments found for this branch/cycle." };
  }

  const assignmentIds = assignments.map((a) => a.id);
  const [{ data: questions }, { data: reviews }, { data: opsAnswers }] = await Promise.all([
    supabase.from("self_audit_audit_questions").select("*"),
    supabase.from("self_audit_ai_reviews").select("*").in("assignment_id", assignmentIds),
    supabase.from("self_audit_branch_operation_answers").select("*").eq("cycle_id", cycleId).eq("branch_id", branchId),
  ]);

  const claimQuestions = (questions ?? []).filter((q) => q.scope === "claim");
  const opsQuestions = (questions ?? []).filter((q) => q.scope === "branch");

  const reviewByAssignmentAndQuestion = new Map((reviews ?? []).map((r) => [`${r.assignment_id}:${r.question_id}`, r]));
  const opsAnswerByQuestion = new Map((opsAnswers ?? []).map((a) => [a.question_id, a]));

  const allScores: number[] = [];
  const perQuestionScores = new Map<string, number[]>();
  const pushScore = (questionId: string, score: number) => {
    allScores.push(score);
    const list = perQuestionScores.get(questionId) ?? [];
    list.push(score);
    perQuestionScores.set(questionId, list);
  };

  assignments.forEach((a) => {
    claimQuestions.forEach((q) => {
      const review = reviewByAssignmentAndQuestion.get(`${a.id}:${q.id}`);
      const finalValue = review ? (review.officer_value ?? review.ai_suggested_value) : null;
      pushScore(q.id, scoreAnswer(q, finalValue));
    });
  });

  opsQuestions.forEach((q) => {
    const answer = opsAnswerByQuestion.get(q.id);
    const finalValue = answer ? (answer.officer_value ?? answer.answer_value) : null;
    pushScore(q.id, scoreAnswer(q, finalValue));
  });

  const breakdown: Record<string, number> = {};
  perQuestionScores.forEach((scores, questionId) => {
    breakdown[questionId] = scorePct(scores);
  });

  const { error: resultError } = await supabase.from("self_audit_audit_results").upsert(
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
  if (resultError) return { error: resultError.message };

  const staleAssignmentIds = assignments.filter((a) => a.status !== "reviewed" && a.status !== "expired").map((a) => a.id);
  if (staleAssignmentIds.length > 0) {
    await supabase.from("self_audit_audit_assignments").update({ status: "expired" }).in("id", staleAssignmentIds);
  }

  await supabase.from("self_audit_branch_operation_progress").upsert(
    {
      cycle_id: cycleId,
      branch_id: branchId,
      status: "reviewed",
      reviewed_at: new Date().toISOString(),
      reviewed_by: officer.id,
    },
    { onConflict: "cycle_id,branch_id" }
  );

  revalidatePath(`/admin/review/${cycleId}/${branchId}`);
  revalidatePath("/admin/results/self-audit");
  revalidatePath(`/admin/results/self-audit/${branchId}`);
  return { success: "Results force-finalized - every unanswered question scored 0%." };
}
