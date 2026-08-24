"use client";

import { useActionState } from "react";
import { saveBranchOps } from "./actions";
import { QuestionField } from "@/components/question-field";
import type { Database } from "@/lib/supabase/types";

type Question = Database["public"]["Tables"]["audit_questions"]["Row"];

export function BranchOpsForm({
  cycleId,
  questions,
  answers,
  locked,
}: {
  cycleId: string;
  questions: Question[];
  answers: Map<string, string | null>;
  locked: boolean;
}) {
  const boundSave = saveBranchOps.bind(null, cycleId);
  const [state, formAction, pending] = useActionState(boundSave, undefined);

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
        {questions.map((q) => (
          <QuestionField
            key={q.id}
            question={q}
            initialValue={answers.get(q.id) ?? null}
            locked={locked}
          />
        ))}
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      {!locked && (
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Submitting..." : "Submit branch operations"}
        </button>
      )}
    </form>
  );
}
