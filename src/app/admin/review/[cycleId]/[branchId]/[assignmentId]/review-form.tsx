"use client";

import { useActionState } from "react";
import { saveReview } from "./actions";
import { ReviewField } from "./review-field";
import type { Database } from "@/lib/supabase/types";

type Question = Database["public"]["Tables"]["audit_questions"]["Row"];

export function ReviewForm({
  assignmentId,
  cycleId,
  branchId,
  questions,
  answers,
  reviews,
  locked,
}: {
  assignmentId: string;
  cycleId: string;
  branchId: string;
  questions: Question[];
  answers: Map<string, { answer_value: string | null; conditional_value: string | null }>;
  reviews: Map<
    string,
    { ai_suggested_value: string | null; ai_reasoning: string | null; ai_confidence: string | null; officer_value: string | null }
  >;
  locked: boolean;
}) {
  const boundAction = saveReview.bind(null, assignmentId, cycleId, branchId);
  const [state, formAction, pending] = useActionState(boundAction, undefined);

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
        {questions.map((q) => {
          const answer = answers.get(q.id);
          const review = reviews.get(q.id);
          return (
            <fieldset key={q.id} disabled={locked}>
              <ReviewField
                question={q}
                adminAnswer={answer?.answer_value ?? null}
                adminConditional={answer?.conditional_value ?? null}
                aiSuggestedValue={review?.ai_suggested_value ?? null}
                aiReasoning={review?.ai_reasoning ?? null}
                aiConfidence={review?.ai_confidence ?? null}
                officerValue={review?.officer_value ?? null}
              />
            </fieldset>
          );
        })}
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      {!locked && (
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save review"}
        </button>
      )}
    </form>
  );
}
