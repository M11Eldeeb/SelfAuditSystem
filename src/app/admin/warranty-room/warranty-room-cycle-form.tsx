"use client";

import { useActionState } from "react";
import { generateWarrantyRoomCycle } from "./cycle-actions";
import { currentYearMonth } from "@/lib/month";

export function WarrantyRoomCycleForm({ branchAdminEmails }: { branchAdminEmails: string[] }) {
  const [state, formAction, pending] = useActionState(generateWarrantyRoomCycle, undefined);

  function handleSendEmail() {
    const appUrl = window.location.origin;
    const subject = "Warranty Room - flagged parts ready for destroy evidence submission";
    const body = `Hello,\n\nYour branch's flagged-to-scrap list is now live in the Warranty Room. Please submit destroy evidence for approval.\n\nSign in: ${appUrl}/audit/warranty-room\n\nWarranty Department`;
    const mailto = `mailto:?bcc=${encodeURIComponent(branchAdminEmails.join(","))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
  }

  return (
    <div className="space-y-3 rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">Warranty room cycle</h2>
        <p className="text-xs text-neutral-500">
          Starts this month&apos;s destroy-evidence submission window - independent of the self-audit cycle. No
          deadline: unsubmitted parts just stay off the Scrapped List until submitted.
        </p>
      </div>
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="wr_cycle_month" className="text-xs font-medium text-neutral-700">
            Cycle month
          </label>
          <input
            id="wr_cycle_month"
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
        <button
          type="button"
          onClick={handleSendEmail}
          disabled={branchAdminEmails.length === 0}
          className="rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          Send an email
        </button>
      </form>
      {branchAdminEmails.length === 0 && (
        <p className="text-xs text-neutral-400">No branch admin accounts found to notify.</p>
      )}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-600">{state.success}</p>}
    </div>
  );
}
