"use client";

import { useActionState } from "react";
import { finalizeInternalAudit } from "../../actions";
import { DEPARTMENT_ORDER, DEPARTMENT_LABELS } from "@/lib/departments";

export function InternalAuditFinalizeForm({
  auditId,
  defaultClosingStatement,
}: {
  auditId: string;
  defaultClosingStatement: string;
}) {
  const boundFinalize = finalizeInternalAudit.bind(null, auditId);
  const [state, formAction, pending] = useActionState(boundFinalize, undefined);

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-1 rounded-lg border border-neutral-200 bg-white p-4">
        <label htmlFor="manager_name" className="text-sm font-medium text-neutral-700">
          Service manager name
        </label>
        <input
          id="manager_name"
          name="manager_name"
          type="text"
          className="w-full max-w-sm rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
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
