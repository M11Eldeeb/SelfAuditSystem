"use client";

import { useActionState } from "react";
import { saveClaimAnswers } from "../actions";
import { QuestionField } from "@/components/question-field";
import { getClaimReference } from "@/lib/claim-reference";
import type { Database } from "@/lib/supabase/types";

type Question = Database["public"]["Tables"]["self_audit_audit_questions"]["Row"];
type Claim = Database["public"]["Tables"]["self_audit_claims"]["Row"];
type QuestionGroup = { departmentId: string; label: string; questions: Question[] };

export function InternalAuditClaimForm({
  auditId,
  internalAuditClaimId,
  claim,
  currentIndex,
  totalClaims,
  questionGroups,
  answers,
  noteText,
  locked,
}: {
  auditId: string;
  internalAuditClaimId: string;
  claim: Claim | null;
  currentIndex: number;
  totalClaims: number;
  questionGroups: QuestionGroup[];
  answers: Map<string, string | null>;
  noteText: string;
  locked: boolean;
}) {
  const boundSave = saveClaimAnswers.bind(null, auditId, internalAuditClaimId, currentIndex, totalClaims);
  const [state, formAction, pending] = useActionState(boundSave, undefined);

  return (
    <form action={formAction} className="space-y-6">
      {questionGroups.map((group) => (
        <div key={group.departmentId} className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-neutral-900">{group.label}</h2>
          {group.questions.map((q) => (
            <QuestionField
              key={q.id}
              question={q}
              initialValue={answers.get(q.id) ?? null}
              locked={locked}
              reference={getClaimReference(q.id, claim)}
            />
          ))}
        </div>
      ))}

      <div className="space-y-1 rounded-lg border border-neutral-200 bg-white p-4">
        <label htmlFor="note" className="text-sm font-medium text-neutral-700">
          Note
        </label>
        <textarea
          id="note"
          name="note"
          rows={3}
          defaultValue={noteText}
          disabled={locked}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      {!locked && (
        <div className="flex flex-wrap gap-3">
          {currentIndex > 0 && (
            <button
              type="submit"
              name="nav"
              value="prev"
              formNoValidate
              disabled={pending}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 disabled:opacity-50"
            >
              ← Save &amp; Previous
            </button>
          )}
          <button
            type="submit"
            name="nav"
            value="stay"
            formNoValidate
            disabled={pending}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 disabled:opacity-50"
          >
            Save
          </button>
          {currentIndex < totalClaims - 1 ? (
            <button
              type="submit"
              name="nav"
              value="next"
              formNoValidate
              disabled={pending}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
            >
              Save &amp; Next →
            </button>
          ) : (
            <button
              type="submit"
              name="nav"
              value="branch-ops"
              formNoValidate
              disabled={pending}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
            >
              {pending ? "Saving..." : "Save & Continue to Branch Operations →"}
            </button>
          )}
        </div>
      )}
    </form>
  );
}
