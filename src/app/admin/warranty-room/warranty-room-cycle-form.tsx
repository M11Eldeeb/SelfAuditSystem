"use client";

import { useActionState } from "react";
import { generateWarrantyRoomCycle } from "./cycle-actions";
import { currentYearMonth } from "@/lib/month";
import { AUDIT_CYCLE_DEADLINE_DAYS } from "@/lib/cycle";

export function WarrantyRoomCycleForm() {
  const [state, formAction, pending] = useActionState(generateWarrantyRoomCycle, undefined);

  return (
    <div className="space-y-3 rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">Warranty room cycle</h2>
        <p className="text-xs text-neutral-500">
          Sets this month&apos;s destroy-evidence deadline ({AUDIT_CYCLE_DEADLINE_DAYS} days) - independent of the
          self-audit cycle.
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
      </form>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-600">{state.success}</p>}
    </div>
  );
}
