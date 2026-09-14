"use client";

import { generateDoNotScrapExcel } from "@/lib/warranty-room/do-not-scrap-excel";
import type { DoNotScrapRow } from "@/lib/warranty-room/do-not-scrap";

/** Shared table + Excel/print actions for the do-not-scrap report, used by both the officer and branch-admin views. */
export function DoNotScrapTable({ branchName, rows }: { branchName: string; rows: DoNotScrapRow[] }) {
  const claimCount = new Set(rows.map((r) => r.claim_number)).size;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <p className="text-sm text-neutral-600">
          {claimCount} claim(s), {rows.length} part row(s) - has parts, not flagged to scrap or already scrapped.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => generateDoNotScrapExcel(branchName, rows)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Download Excel
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Print
          </button>
        </div>
      </div>

      <div className="max-h-[36rem] overflow-auto rounded-lg border border-neutral-200 bg-white print:max-h-none print:overflow-visible">
        <table className="w-full min-w-[64rem] text-sm">
          <thead className="sticky top-0 bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500 print:static">
            <tr>
              <th className="px-4 py-2">Claim</th>
              <th className="px-4 py-2">Work order</th>
              <th className="px-4 py-2">VIN</th>
              <th className="px-4 py-2">Vehicle series</th>
              <th className="px-4 py-2">Part</th>
              <th className="px-4 py-2">Qty</th>
              <th className="px-4 py-2">Reception date</th>
              <th className="px-4 py-2">First submit date</th>
              <th className="px-4 py-2">End of repair date</th>
              <th className="px-4 py-2">Holding period</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r, i) => (
              <tr key={`${r.claim_number}-${r.part_no ?? "none"}-${i}`}>
                <td className="px-4 py-2 text-neutral-900">{r.claim_number}</td>
                <td className="px-4 py-2 text-neutral-600">{r.work_order_no ?? "—"}</td>
                <td className="px-4 py-2 text-neutral-600">{r.vin ?? "—"}</td>
                <td className="px-4 py-2 text-neutral-600">{r.vehicle_series ?? "—"}</td>
                <td className="px-4 py-2 text-neutral-600">
                  {r.part_name ?? "—"} {r.part_no && `(${r.part_no})`}
                </td>
                <td className="px-4 py-2 text-neutral-600">{r.quantity ?? "—"}</td>
                <td className="px-4 py-2 text-neutral-600">{r.creation_date}</td>
                <td className="px-4 py-2 text-neutral-600">{r.first_submit_date ?? "—"}</td>
                <td className="px-4 py-2 text-neutral-600">{r.repair_end_date ?? "—"}</td>
                <td className="px-4 py-2 text-neutral-600">
                  {r.holding_period_days != null ? `${r.holding_period_days} day(s)` : "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-neutral-400">
                  Nothing to show.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
