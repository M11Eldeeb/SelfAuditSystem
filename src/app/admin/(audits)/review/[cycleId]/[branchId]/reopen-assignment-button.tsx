"use client";

import { useActionState } from "react";
import { reopenExpiredAssignment } from "./actions";

export function ReopenAssignmentButton({
  cycleId,
  branchId,
  assignmentId,
}: {
  cycleId: string;
  branchId: string;
  assignmentId: string;
}) {
  const boundAction = reopenExpiredAssignment.bind(null, cycleId, branchId, assignmentId);
  const [state, formAction, pending] = useActionState(boundAction, undefined);

  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      <button
        type="submit"
        disabled={pending}
        className="text-xs font-medium text-brand hover:underline disabled:opacity-50"
      >
        {pending ? "Reopening..." : "Reopen for submission"}
      </button>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
