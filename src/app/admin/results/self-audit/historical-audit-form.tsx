"use client";

import { useActionState, useState } from "react";
import { createHistoricalSelfAudit } from "./historical-actions";
import { WarrantyRoomFileUploadField } from "@/components/warranty-room-file-upload-field";
import { currentYearMonth } from "@/lib/month";

export function HistoricalSelfAuditForm({ branches }: { branches: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createHistoricalSelfAudit, undefined);
  const [formKey, setFormKey] = useState(0);

  // Remounting the whole form (uncontrolled fields all use defaultValue)
  // right after a successful submit clears every field, including the file
  // field's internal "uploaded" state - so the next entry can't silently
  // reuse the previous one's PDF path. Done during render (React's
  // documented pattern for reacting to a state change) rather than in an
  // effect, since this must happen before the browser paints stale values.
  const [lastHandledState, setLastHandledState] = useState(state);
  if (state !== lastHandledState) {
    setLastHandledState(state);
    if (state?.success) setFormKey((k) => k + 1);
  }

  return (
    <form key={formKey} action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor="sa_branch_id" className="text-xs font-medium text-neutral-700">
            Branch
          </label>
          <select
            id="sa_branch_id"
            name="branch_id"
            required
            defaultValue=""
            className="w-full rounded-lg border border-neutral-300 bg-white shadow-sm px-3 py-1.5 text-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
          >
            <option value="" disabled>
              Select a branch
            </option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="sa_period_month" className="text-xs font-medium text-neutral-700">
            Month
          </label>
          <input
            id="sa_period_month"
            name="period_month"
            type="month"
            required
            defaultValue={currentYearMonth()}
            className="w-full rounded-lg border border-neutral-300 bg-white shadow-sm px-3 py-1.5 text-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="sa_score_pct" className="text-xs font-medium text-neutral-700">
            Score (%)
          </label>
          <input
            id="sa_score_pct"
            name="score_pct"
            type="number"
            min={0}
            max={100}
            step="0.1"
            required
            className="w-full rounded-lg border border-neutral-300 bg-white shadow-sm px-3 py-1.5 text-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="sa_notes" className="text-xs font-medium text-neutral-700">
          Notes (optional)
        </label>
        <textarea
          id="sa_notes"
          name="notes"
          rows={2}
          className="w-full rounded-lg border border-neutral-300 bg-white shadow-sm px-3 py-1.5 text-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
        />
      </div>

      <WarrantyRoomFileUploadField
        label="Report PDF (optional)"
        helpText="Leave empty if no PDF exists for this result."
        accept="application/pdf"
        fieldName="pdf_path"
        buildPath={(ext) => `historical-audits/self-audit/${crypto.randomUUID()}.${ext}`}
      />

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-brand shadow-sm shadow-brand/25 hover:shadow-md hover:shadow-brand/30 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
      >
        {pending ? "Saving..." : "Add historical result"}
      </button>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-600">{state.success}</p>}
    </form>
  );
}
