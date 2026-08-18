"use client";

import { useActionState } from "react";
import { deleteBranch } from "./actions";

export function DeleteBranchButton({ branchId, name }: { branchId: string; name: string }) {
  const [state, formAction, pending] = useActionState(deleteBranch, undefined);

  return (
    <div className="flex flex-col items-end gap-1">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!window.confirm(`Delete branch "${name}"? This can't be undone.`)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="branch_id" value={branchId} />
        <input type="hidden" name="name" value={name} />
        <button
          type="submit"
          disabled={pending}
          className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
        >
          {pending ? "Deleting..." : "Delete"}
        </button>
      </form>
      {state?.error && <p className="max-w-[220px] text-right text-xs text-red-600">{state.error}</p>}
    </div>
  );
}
