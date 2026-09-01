import type { Database } from "@/lib/supabase/types";
import { scoreAnswer } from "@/lib/scoring";
import { DEPARTMENT_ORDER, DEPARTMENT_LABELS } from "@/lib/departments";

type Question = Database["public"]["Tables"]["self_audit_audit_questions"]["Row"];

export type CheckpointScore = {
  questionId: string;
  label: string;
  departmentId: string;
  pct: number | null;
  answered: number;
};

export type DepartmentScore = {
  departmentId: string;
  label: string;
  pct: number | null;
  answered: number;
};

export type InternalAuditScores = {
  overallScore: number;
  departmentScores: DepartmentScore[];
  checkpointScores: CheckpointScore[];
  perQuestionBreakdown: Record<string, number | null>;
};

/**
 * Mirrors warranty_audit_app.html's deptStats()/checkpointStats()/overallScore():
 * a department's score is a FLAT mean across every (checkpoint x claim) pair
 * answered within it (not an average of per-checkpoint averages); the overall
 * score is then an unweighted average of the answered departments' scores
 * (small departments count the same as large ones).
 *
 * `claimAnswersByQuestion` holds every sampled claim's raw answer_value for
 * claim/parts-scope questions; `branchAnswersByQuestion` holds the single
 * answer_value for branch-scope questions.
 */
export function computeInternalAuditScores(
  questions: Question[],
  claimAnswersByQuestion: Map<string, string[]>,
  branchAnswersByQuestion: Map<string, string | null>
): InternalAuditScores {
  const checkpointScores: CheckpointScore[] = questions.map((q) => {
    if (q.scope === "branch") {
      const value = branchAnswersByQuestion.get(q.id) ?? null;
      const pct = value != null ? Math.round(scoreAnswer(q, value) * 1000) / 10 : null;
      return { questionId: q.id, label: q.text, departmentId: q.department ?? "", pct, answered: value != null ? 1 : 0 };
    }
    const values = claimAnswersByQuestion.get(q.id) ?? [];
    const scored = values.filter((v) => v != null).map((v) => scoreAnswer(q, v) * 100);
    const pct = scored.length ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10 : null;
    return { questionId: q.id, label: q.text, departmentId: q.department ?? "", pct, answered: scored.length };
  });

  const departmentScores: DepartmentScore[] = DEPARTMENT_ORDER.filter((dept) =>
    questions.some((q) => q.department === dept)
  ).map((dept) => {
    const deptQuestions = questions.filter((q) => q.department === dept);
    if (deptQuestions[0]?.scope === "branch") {
      const answeredPcts = deptQuestions
        .map((q) => checkpointScores.find((c) => c.questionId === q.id)?.pct)
        .filter((v): v is number => v != null);
      const pct = answeredPcts.length ? Math.round(answeredPcts.reduce((a, b) => a + b, 0) / answeredPcts.length) : null;
      return { departmentId: dept, label: DEPARTMENT_LABELS[dept], pct, answered: answeredPcts.length };
    }
    let sum = 0;
    let count = 0;
    for (const q of deptQuestions) {
      const values = claimAnswersByQuestion.get(q.id) ?? [];
      for (const v of values) {
        if (v == null) continue;
        sum += scoreAnswer(q, v) * 100;
        count += 1;
      }
    }
    const pct = count ? Math.round((sum / count) * 10) / 10 : null;
    return { departmentId: dept, label: DEPARTMENT_LABELS[dept], pct, answered: count };
  });

  const answeredDepts = departmentScores.filter((d) => d.pct != null);
  const overallScore = answeredDepts.length
    ? Math.round((answeredDepts.reduce((a, d) => a + (d.pct as number), 0) / answeredDepts.length) * 10) / 10
    : 0;

  const perQuestionBreakdown: Record<string, number | null> = {};
  checkpointScores.forEach((c) => {
    perQuestionBreakdown[c.questionId] = c.pct;
  });

  return { overallScore, departmentScores, checkpointScores, perQuestionBreakdown };
}

/** Ported verbatim from warranty_audit_app.html's closingStatement(). */
export function defaultClosingStatement(score: number): string {
  if (score >= 90) {
    return "Branch processes are strong and well-controlled. The findings below are minor and refinements rather than corrective actions.";
  }
  if (score >= 75) {
    return "Branch processes are generally sound. A small number of recurring gaps were found - addressing the items below should move the branch into the top tier.";
  }
  if (score >= 60) {
    return "Branch processes are functional but inconsistent. Several checkpoints show repeat failures across the sample and warrant a focused corrective action plan.";
  }
  return "Branch processes require immediate attention. Multiple checkpoints failed across a majority of the sample, indicating a systemic rather than isolated issue.";
}
