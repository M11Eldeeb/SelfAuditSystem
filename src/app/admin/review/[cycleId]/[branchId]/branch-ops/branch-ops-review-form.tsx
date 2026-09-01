"use client";

import { useActionState, useState } from "react";
import { saveBranchOpsReview } from "./actions";
import { ScorePicker } from "@/components/score-picker";
import type { Database } from "@/lib/supabase/types";

type Question = Database["public"]["Tables"]["self_audit_audit_questions"]["Row"];

export function BranchOpsReviewForm({
  cycleId,
  branchId,
  questions,
  answers,
  locked,
}: {
  cycleId: string;
  branchId: string;
  questions: Question[];
  answers: Map<string, { answer_value: string | null; officer_value: string | null }>;
  locked: boolean;
}) {
  const boundAction = saveBranchOpsReview.bind(null, cycleId, branchId);
  const [state, formAction, pending] = useActionState(boundAction, undefined);

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
        {questions.map((q) => (
          <BranchOpsQuestionRow
            key={q.id}
            question={q}
            adminAnswer={answers.get(q.id)?.answer_value ?? null}
            officerValue={answers.get(q.id)?.officer_value ?? null}
            locked={locked}
          />
        ))}
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      {!locked && (
        <button
          type="submit"
          formNoValidate
          disabled={pending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save review"}
        </button>
      )}
    </form>
  );
}

function BranchOpsQuestionRow({
  question,
  adminAnswer,
  officerValue,
  locked,
}: {
  question: Question;
  adminAnswer: string | null;
  officerValue: string | null;
  locked: boolean;
}) {
  const [value, setValue] = useState(officerValue ?? adminAnswer ?? "");

  return (
    <fieldset disabled={locked} className="space-y-2 border-b border-neutral-100 pb-4">
      <legend className="text-sm font-medium text-neutral-900">{question.text}</legend>
      {question.help_text && <p className="text-xs text-neutral-500">{question.help_text}</p>}
      <p className="text-xs text-neutral-600">
        Branch admin answered:{" "}
        <span className="font-medium text-neutral-900">
          {adminAnswer !== null ? `${adminAnswer}%` : "(no answer)"}
        </span>
      </p>
      <ScorePicker name={`officer_${question.id}`} value={value} onChange={setValue} required disabled={locked} />
    </fieldset>
  );
}
