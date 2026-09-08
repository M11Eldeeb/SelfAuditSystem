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
  mode,
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
  mode: "documents" | "parts";
  questionGroups: QuestionGroup[];
  answers: Map<string, string | null>;
  noteText: string;
  locked: boolean;
}) {
  const boundSave = saveClaimAnswers.bind(null, auditId, internalAuditClaimId, currentIndex, totalClaims, mode);
  const [state, formAction, pending] = useActionState(boundSave, undefined);

  return (
    <form id="internal-audit-claim-form" action={formAction} className="space-y-6" noValidate>
      {/* noValidate: every submit button below already opts out of native
          HTML5 required-field validation via formNoValidate (the mandatory-
          answer check is enforced server-side, only for Save & Next). The
          work-order search submits this form programmatically via
          requestSubmit() with no submitter button, so without noValidate on
          the form itself the browser would silently block that submission
          on any unanswered required question - defeating "jump away from an
          unfinished claim". */}
      {/* Set and submitted programmatically by WorkOrderSearch to save
          whatever's filled in here (even if incomplete) before jumping to a
          different claim, without running the "answer everything" check
          that only applies to Save & Next. */}
      <input type="hidden" id="jump_to_index_input" name="jump_to_index" defaultValue="" />
      {/* Lets the save action know the full set of question ids for this
          mode without re-querying self_audit_audit_questions - the page
          already knows this from rendering questionGroups below, and an
          unanswered radio group submits no form field at all, so the action
          can't otherwise tell "unanswered" apart from "not part of this
          mode" without this list. */}
      <input
        type="hidden"
        name="mode_question_ids"
        value={questionGroups.flatMap((g) => g.questions.map((q) => q.id)).join(",")}
        readOnly
      />
      {questionGroups.map((group) => (
        <div key={group.departmentId} className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-neutral-900">{group.label}</h2>
          {group.questions.map((q) => (
            <QuestionField
              // Keyed on internalAuditClaimId too: jumping between claims
              // (via Save & Next/Previous, or the work-order search) is a
              // client-side transition that reuses this component instance
              // at the same tree position - without a claim-specific key its
              // internal useState(initialValue) wouldn't reset, so the
              // PREVIOUS claim's selected answer would still show as
              // selected here until manually changed.
              key={`${internalAuditClaimId}-${q.id}`}
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
          {currentIndex < totalClaims - 1 && (
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
          )}
        </div>
      )}
    </form>
  );
}
