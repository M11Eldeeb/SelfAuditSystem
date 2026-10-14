"use client";

import { useActionState, useState } from "react";
import { generateCycle } from "./actions";
import { sendSelfAuditReadyMails } from "@/app/admin/emails/actions";
import { currentYearMonth } from "@/lib/month";

export function CycleForm() {
  const [state, formAction, pending] = useActionState(generateCycle, undefined);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: boolean; text: string } | null>(null);

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="cycle_month" className="text-xs font-medium text-neutral-700">
            Audit cycle month
          </label>
          <input
            id="cycle_month"
            name="cycle_month"
            type="month"
            required
            defaultValue={currentYearMonth()}
            className="rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand shadow-sm shadow-brand/25 hover:shadow-md hover:shadow-brand/30 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Generating..." : "Generate cycle"}
        </button>
      </form>
      <p className="text-xs text-neutral-500">
        Picks up to 10 random claims (parts claims only - labor-only claims are skipped) per active
        branch, created during the previous month, and assigns them for self-audit. Closed branches
        are skipped entirely.
      </p>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-600">{state.success}</p>}

      {state?.success && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-800">
            {state.notifyEmails && state.notifyEmails.length > 0
              ? "Branch admins haven't been told yet - send them the notification email (sent by the portal, with the copies set in Settings → Email settings)."
              : "No branch admin accounts found for the branches assigned claims this cycle - nothing to notify."}
          </p>
          {state.cycleId && state.notifyEmails && state.notifyEmails.length > 0 && (
            <button
              type="button"
              disabled={sending || sendResult?.sent}
              onClick={() => {
                setSendResult(null);
                setSending(true);
                void sendSelfAuditReadyMails(state.cycleId!).then((res) => {
                  setSending(false);
                  if (res.error) return setSendResult({ sent: false, text: res.error });
                  const outcomes = res.outcomes ?? [];
                  const ok = outcomes.filter((o) => o.status === "sent" || o.status === "already-sent").length;
                  const problems = outcomes.filter((o) => o.status === "failed" || o.status === "no-recipients");
                  setSendResult({
                    sent: ok > 0 && problems.length === 0,
                    text:
                      `Sent to ${ok} of ${outcomes.length} branch${outcomes.length === 1 ? "" : "es"}.` +
                      (problems.length ? ` Not sent: ${problems.map((o) => `${o.branchName} (${o.error ?? o.status})`).join("; ")}.` : ""),
                  });
                });
              }}
              className="shrink-0 rounded-lg bg-brand shadow-sm shadow-brand/25 hover:shadow-md hover:shadow-brand/30 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
            >
              {sending ? "Sending..." : "Send mail"}
            </button>
          )}
        </div>
      )}

      {sendResult && (
        <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${sendResult.sent ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          {sendResult.text}
        </p>
      )}

      {state?.perBranch && (
        <div className="overflow-hidden rounded-lg border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-semibold tracking-wide text-neutral-500 uppercase border-b border-neutral-200">
              <tr>
                <th className="px-4 py-2">Branch</th>
                <th className="px-4 py-2">Claims available</th>
                <th className="px-4 py-2">Assigned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {state.perBranch.map((b) => (
                <tr key={b.branchName}>
                  <td className="px-4 py-2 text-neutral-900">{b.branchName}</td>
                  <td className="px-4 py-2 text-neutral-600">{b.available}</td>
                  <td className="px-4 py-2 text-neutral-600">
                    {b.assigned}
                    {b.assigned < 10 && (
                      <span className="ml-2 text-amber-600">
                        (fewer than 10 claims available)
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
