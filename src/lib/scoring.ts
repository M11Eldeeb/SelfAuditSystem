import type { Database } from "@/lib/supabase/types";

type Question = Database["public"]["Tables"]["audit_questions"]["Row"];

/** Full credit for compliant_options, half credit for partial_credit_options, else 0. */
export function scoreAnswer(question: Question, answerValue: string | null): number {
  if (!answerValue) return 0;
  if (question.compliant_options.includes(answerValue)) return 1;
  if (question.partial_credit_options.includes(answerValue)) return 0.5;
  return 0;
}

export function scorePct(scores: number[]): number {
  if (scores.length === 0) return 0;
  const total = scores.reduce((sum, s) => sum + s, 0);
  return Math.round((total / scores.length) * 1000) / 10; // one decimal place
}
