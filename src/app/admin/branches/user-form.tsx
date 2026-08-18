"use client";

import { useActionState, useRef, useState, useEffect } from "react";
import { createUser } from "./actions";

export function UserForm({ branches }: { branches: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createUser, undefined);
  const [role, setRole] = useState<"officer" | "branch_admin">("branch_admin");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state?.success]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label htmlFor="user-email" className="text-xs font-medium text-neutral-700">
          Email
        </label>
        <input
          id="user-email"
          name="email"
          type="email"
          required
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="user-name" className="text-xs font-medium text-neutral-700">
          Full name
        </label>
        <input
          id="user-name"
          name="full_name"
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="user-role" className="text-xs font-medium text-neutral-700">
          Role
        </label>
        <select
          id="user-role"
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value as "officer" | "branch_admin")}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        >
          <option value="branch_admin">Branch admin</option>
          <option value="officer">Warranty officer</option>
        </select>
      </div>
      {role === "branch_admin" && (
        <div className="space-y-1">
          <label htmlFor="user-branch" className="text-xs font-medium text-neutral-700">
            Branch
          </label>
          <select
            id="user-branch"
            name="branch_id"
            required
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          >
            <option value="">Select branch</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
      >
        {pending ? "Creating..." : "Create account"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
      {state?.success && (
        <p className="w-full text-sm text-emerald-600">
          {state.success}
          {state.tempPassword && (
            <>
              {" "}
              Temporary password: <code className="rounded bg-emerald-50 px-1.5 py-0.5">{state.tempPassword}</code>{" "}
              — share this with them securely, it won&apos;t be shown again.
            </>
          )}
        </p>
      )}
    </form>
  );
}
