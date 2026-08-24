import type { Database } from "@/lib/supabase/types";

type Question = Database["public"]["Tables"]["audit_questions"]["Row"];

/**
 * score_5 questions store the answer as one of "0"/"25"/"50"/"75"/"100" and
 * score directly as that percentage. Older question types (kept for backward
 * compatibility) fall back to full credit for compliant_options, half credit
 * for partial_credit_options, else 0.
 */
export function scoreAnswer(question: Question, answerValue: string | null): number {
  if (!answerValue) return 0;
  if (question.type === "score_5") {
    const n = Number(answerValue);
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) / 100 : 0;
  }
  if (question.compliant_options.includes(answerValue)) return 1;
  if (question.partial_credit_options.includes(answerValue)) return 0.5;
  return 0;
}

export function scorePct(scores: number[]): number {
  if (scores.length === 0) return 0;
  const total = scores.reduce((sum, s) => sum + s, 0);
  return Math.round((total / scores.length) * 1000) / 10; // one decimal place
}
