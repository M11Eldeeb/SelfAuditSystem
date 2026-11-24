"use client";

import { useActionState } from "react";
import { sendWelcomeEmail } from "./actions";

/** Service advisors and the reception team: send the welcome e-mail (a new temporary password and the Courtesy Cars guide). */
export function WelcomeEmailButton({ userId, email }: { userId: string; email: string }) {
  const [state, formAction, pending] = useActionState(sendWelcomeEmail, undefined);
  return (
    <div className="flex flex-col items-end gap-1">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!window.confirm(`Send the welcome e-mail to ${email}? A new temporary password is set and sent in it; the old one stops working.`)) e.preventDefault();
        }}
      >
        <input type="hidden" name="user_id" value={userId} />
        <button type="submit" disabled={pending} className="text-xs font-semibold text-brand hover:text-brand-dark disabled:opacity-50">
          {pending ? "Sending..." : "Send welcome e-mail"}
        </button>
      </form>
      {state?.success && <p className="max-w-[220px] text-right text-xs text-emerald-600">{state.success}</p>}
      {state?.error && (
        <p className="max-w-[240px] text-right text-xs text-red-600">
          {state.error}
          {state.tempPassword && (
            <>
              {" "}
              New password: <code className="rounded bg-red-50 px-1 py-0.5">{state.tempPassword}</code>
            </>
          )}
        </p>
      )}
    </div>
  );
}
