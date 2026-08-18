"use client";

import { useActionState } from "react";
import { generateCycle } from "./actions";
import { currentYearMonth } from "@/lib/month";

export function CycleForm() {
  const [state, formAction, pending] = useActionState(generateCycle, undefined);

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
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Generating..." : "Generate cycle"}
        </button>
      </form>
      <p className="text-xs text-neutral-500">
        Picks up to 10 random claims per branch created during the previous month and assigns them
        for self-audit.
      </p>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-600">{state.success}</p>}

      {state?.perBranch && (
        <div className="overflow-hidden rounded-lg border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
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
