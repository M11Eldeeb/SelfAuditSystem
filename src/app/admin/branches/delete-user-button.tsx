"use client";

import { useActionState } from "react";
import { deleteUser } from "./actions";

export function DeleteUserButton({ userId, email }: { userId: string; email: string }) {
  const [state, formAction, pending] = useActionState(deleteUser, undefined);

  return (
    <div className="flex flex-col items-end gap-1">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!window.confirm(`Delete the account for ${email}? This can't be undone.`)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="user_id" value={userId} />
        <input type="hidden" name="email" value={email} />
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
