"use client";

import { useActionState } from "react";
import { saveReview } from "./actions";
import { ReviewField } from "./review-field";
import { getClaimReference } from "@/lib/claim-reference";
import type { Database } from "@/lib/supabase/types";

type Question = Database["public"]["Tables"]["self_audit_audit_questions"]["Row"];
type Claim = Database["public"]["Tables"]["self_audit_claims"]["Row"];

export function ReviewForm({
  assignmentId,
  cycleId,
  branchId,
  claim,
  questions,
  answers,
  reviews,
  locked,
  overallComment = null,
}: {
  assignmentId: string;
  cycleId: string;
  branchId: string;
  claim: Claim | null;
  questions: Question[];
  answers: Map<string, { answer_value: string | null; conditional_value: string | null }>;
  reviews: Map<
    string,
    { ai_suggested_value: string | null; ai_reasoning: string | null; ai_confidence: string | null; officer_value: string | null; officer_comment: string | null }
  >;
  locked: boolean;
  /** The officer's comment on the claim as a whole. */
  overallComment?: string | null;
}) {
  const boundAction = saveReview.bind(null, assignmentId, cycleId, branchId);
  const [state, formAction, pending] = useActionState(boundAction, undefined);

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-4 rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
        {questions.map((q) => {
          const answer = answers.get(q.id);
          const review = reviews.get(q.id);
          return (
            // Keyed on assignmentId too, same reason as audit-form.tsx's
            // QuestionField: without it, navigating between claims reuses
            // this component instance and its internal ScorePicker state
            // wouldn't reset to the new claim's answer.
            <fieldset key={`${assignmentId}-${q.id}`} disabled={locked}>
              <ReviewField
                question={q}
                adminAnswer={answer?.answer_value ?? null}
                aiSuggestedValue={review?.ai_suggested_value ?? null}
                aiReasoning={review?.ai_reasoning ?? null}
                aiConfidence={review?.ai_confidence ?? null}
                officerValue={review?.officer_value ?? null}
                reference={getClaimReference(q.id, claim)}
              />
              <textarea
                name={`comment_${q.id}`}
                defaultValue={review?.officer_comment ?? ""}
                rows={1}
                placeholder="Comment (optional)"
                className="mt-2 w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm placeholder:text-neutral-400 focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
              />
            </fieldset>
          );
        })}
      </div>

      <fieldset disabled={locked} className="space-y-1 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
        <label htmlFor="overall_comment" className="text-sm font-semibold text-neutral-900">
          Overall comment on this claim
        </label>
        <textarea
          id="overall_comment"
          name="overall_comment"
          defaultValue={overallComment ?? ""}
          rows={3}
          placeholder="Optional - the branch sees it with the result"
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
        />
      </fieldset>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      {!locked && (
        <button
          type="submit"
          formNoValidate
          disabled={pending}
          className="rounded-lg bg-brand shadow-sm shadow-brand/25 hover:shadow-md hover:shadow-brand/30 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save review"}
        </button>
      )}
    </form>
  );
}
