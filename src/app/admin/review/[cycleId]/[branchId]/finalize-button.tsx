"use client";

import { useActionState } from "react";
import { finalizeBranchAudit } from "./actions";

export function FinalizeButton({
  cycleId,
  branchId,
  disabled,
}: {
  cycleId: string;
  branchId: string;
  disabled: boolean;
}) {
  const boundAction = finalizeBranchAudit.bind(null, cycleId, branchId);
  const [state, formAction, pending] = useActionState(boundAction, undefined);

  return (
    <form action={formAction} className="space-y-2">
      <button
        type="submit"
        disabled={disabled || pending}
        className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
      >
        {pending ? "Finalizing..." : "Finalize results"}
      </button>
      {disabled && (
        <p className="text-xs text-neutral-500">
          All claims and the branch operations questionnaire must be reviewed first.
        </p>
      )}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-600">{state.success}</p>}
    </form>
  );
}
