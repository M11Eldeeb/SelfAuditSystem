"use client";

import { useState, useTransition } from "react";
import { updateBranch } from "./actions";
import { DeleteBranchButton } from "./delete-branch-button";
import type { Database } from "@/lib/supabase/types";

type Branch = Database["public"]["Tables"]["branches"]["Row"];

export function BranchRow({ branch }: { branch: Branch }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await updateBranch(undefined, formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setEditing(false);
      }
    });
  };

  if (!editing) {
    return (
      <tr>
        <td className="px-4 py-2 text-neutral-900">{branch.name}</td>
        <td className="px-4 py-2 text-neutral-600">{branch.code}</td>
        <td className="px-4 py-2 text-right">
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-neutral-600 hover:text-neutral-900"
            >
              Edit
            </button>
            <DeleteBranchButton branchId={branch.id} name={branch.name} />
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={3} className="px-4 py-3">
        <form action={handleSubmit} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="branch_id" value={branch.id} />
          <div className="space-y-1">
            <label className="text-xs font-medium text-neutral-700">Branch name</label>
            <input
              name="name"
              defaultValue={branch.name}
              required
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-neutral-700">Code</label>
            <input
              name="code"
              defaultValue={branch.code}
              required
              className="w-32 rounded-md border border-neutral-300 px-3 py-1.5 text-sm uppercase"
            />
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
          >
            {isPending ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            className="text-sm text-neutral-600 hover:text-neutral-900"
          >
            Cancel
          </button>
          {error && <p className="w-full text-sm text-red-600">{error}</p>}
        </form>
      </td>
    </tr>
  );
}
