"use client";

import { useActionState } from "react";
import { resetUserPassword } from "./actions";

export function ResetPasswordButton({ userId, email }: { userId: string; email: string }) {
  const [state, formAction, pending] = useActionState(resetUserPassword, undefined);

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="user_id" value={userId} />
        <input type="hidden" name="email" value={email} />
        <button
          type="submit"
          disabled={pending}
          className="text-xs text-neutral-600 hover:text-neutral-900 disabled:opacity-50"
        >
          {pending ? "Resetting..." : "Reset password"}
        </button>
      </form>
      {state?.tempPassword && (
        <p className="max-w-[220px] text-right text-xs text-emerald-600">
          New password: <code className="rounded bg-emerald-50 px-1 py-0.5">{state.tempPassword}</code>
        </p>
      )}
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
    </div>
  );
}
