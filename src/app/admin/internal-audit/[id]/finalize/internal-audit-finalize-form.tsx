"use client";

import { useActionState } from "react";
import { finalizeInternalAudit } from "../../actions";
import { DEPARTMENT_ORDER, DEPARTMENT_LABELS } from "@/lib/departments";

type CandidateRecommendation = { questionId: string; dept: string; checkpoint: string; pct: number; text: string };

export function InternalAuditFinalizeForm({
  auditId,
  defaultAuditorName,
  defaultManagerName,
  defaultClosingStatement,
  candidateRecommendations,
}: {
  auditId: string;
  defaultAuditorName: string;
  defaultManagerName: string;
  defaultClosingStatement: string;
  candidateRecommendations: CandidateRecommendation[];
}) {
  const boundFinalize = finalizeInternalAudit.bind(null, auditId);
  const [state, formAction, pending] = useActionState(boundFinalize, undefined);

  return (
    <form action={formAction} className="space-y-6">
      <div className="grid gap-4 rounded-lg border border-neutral-200 bg-white p-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="auditor_name" className="text-sm font-medium text-neutral-700">
            Auditor name <span className="text-red-500">*</span>
          </label>
          <input
            id="auditor_name"
            name="auditor_name"
            type="text"
            required
            defaultValue={defaultAuditorName}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="manager_name" className="text-sm font-medium text-neutral-700">
            Service manager name <span className="text-red-500">*</span>
          </label>
          <input
            id="manager_name"
            name="manager_name"
            type="text"
            required
            defaultValue={defaultManagerName}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900">Department remarks</h2>
        {DEPARTMENT_ORDER.map((dept) => (
          <div key={dept} className="space-y-1">
            <label htmlFor={`remark_${dept}`} className="text-sm font-medium text-neutral-700">
              {DEPARTMENT_LABELS[dept]}
            </label>
            <textarea
              id={`remark_${dept}`}
              name={`remark_${dept}`}
              rows={2}
              placeholder={`Observations for ${DEPARTMENT_LABELS[dept]}...`}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
        ))}
      </div>

      {candidateRecommendations.length > 0 && (
        <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">Recommendations</h2>
            <p className="text-xs text-neutral-500">
              Auto-suggested for every checkpoint that scored below 80%. Edit the wording or check
              &quot;Remove&quot; to drop one before finalizing - only what&apos;s left here appears on the report.
            </p>
          </div>
          <input
            type="hidden"
            name="recommendation_question_ids"
            value={candidateRecommendations.map((r) => r.questionId).join(",")}
          />
          {candidateRecommendations.map((r) => (
            <div key={r.questionId} className="space-y-1 border-b border-neutral-100 pb-3 last:border-0 last:pb-0">
              <input type="hidden" name={`rec_dept_${r.questionId}`} value={r.dept} />
              <input type="hidden" name={`rec_checkpoint_${r.questionId}`} value={r.checkpoint} />
              <input type="hidden" name={`rec_pct_${r.questionId}`} value={r.pct} />
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={`rec_text_${r.questionId}`} className="text-sm font-medium text-neutral-900">
                  {r.dept} &middot; {r.checkpoint} ({r.pct}%)
                </label>
                <label className="flex items-center gap-1.5 text-xs text-neutral-600">
                  <input type="checkbox" name={`rec_remove_${r.questionId}`} value="1" className="accent-brand" />
                  Remove
                </label>
              </div>
              <textarea
                id={`rec_text_${r.questionId}`}
                name={`rec_text_${r.questionId}`}
                rows={2}
                defaultValue={r.text}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1 rounded-lg border border-neutral-200 bg-white p-4">
        <label htmlFor="closing_statement" className="text-sm font-medium text-neutral-700">
          Closing statement
        </label>
        <textarea
          id="closing_statement"
          name="closing_statement"
          rows={4}
          defaultValue={defaultClosingStatement}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
      >
        {pending ? "Finalizing..." : "Finalize internal audit"}
      </button>
    </form>
  );
}
