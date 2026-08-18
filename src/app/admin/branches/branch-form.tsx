"use client";

import { useActionState, useRef, useEffect } from "react";
import { createBranch } from "./actions";

export function BranchForm() {
  const [state, formAction, pending] = useActionState(createBranch, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state?.success]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label htmlFor="branch-name" className="text-xs font-medium text-neutral-700">
          Branch name
        </label>
        <input
          id="branch-name"
          name="name"
          required
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="branch-code" className="text-xs font-medium text-neutral-700">
          Code
        </label>
        <input
          id="branch-code"
          name="code"
          required
          placeholder="e.g. CAI01"
          className="w-32 rounded-md border border-neutral-300 px-3 py-1.5 text-sm uppercase"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
      >
        {pending ? "Adding..." : "Add branch"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="w-full text-sm text-emerald-600">{state.success}</p>}
    </form>
  );
}
