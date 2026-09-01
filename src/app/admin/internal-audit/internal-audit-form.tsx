"use client";

import { useActionState } from "react";
import { startInternalAudit } from "./actions";

type Branch = { id: string; name: string };

export function InternalAuditForm({ branches }: { branches: Branch[] }) {
  const [state, formAction, pending] = useActionState(startInternalAudit, undefined);

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="branch_id" className="text-xs font-medium text-neutral-700">
            Branch
          </label>
          <select
            id="branch_id"
            name="branch_id"
            defaultValue=""
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900"
          >
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="date_from" className="text-xs font-medium text-neutral-700">
            Submitted from
          </label>
          <input
            id="date_from"
            name="date_from"
            type="date"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="date_to" className="text-xs font-medium text-neutral-700">
            Submitted to
          </label>
          <input
            id="date_to"
            name="date_to"
            type="date"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="sample_size" className="text-xs font-medium text-neutral-700">
            Sample size
          </label>
          <input
            id="sample_size"
            name="sample_size"
            type="number"
            min={1}
            required
            defaultValue={15}
            className="w-24 rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="sample_mode" className="text-xs font-medium text-neutral-700">
            Sample mode
          </label>
          <select
            id="sample_mode"
            name="sample_mode"
            defaultValue="flagged"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900"
          >
            <option value="flagged">Highest audit flag first (risk-based)</option>
            <option value="random">Random</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="max_per_part" className="text-xs font-medium text-neutral-700">
            Max per labor code
          </label>
          <input
            id="max_per_part"
            name="max_per_part"
            type="number"
            min={1}
            placeholder="No limit"
            className="w-28 rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Sampling..." : "Start internal audit"}
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        Caps how many sampled claims can share the same repair (grouped by labor code) so the sample
        isn&apos;t dominated by one repair type. Claims already covered by self-audit or a past
        internal audit are automatically excluded.
      </p>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
