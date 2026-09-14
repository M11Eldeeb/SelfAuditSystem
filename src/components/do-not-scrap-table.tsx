"use client";

import { generateDoNotScrapExcel } from "@/lib/warranty-room/do-not-scrap-excel";
import type { DoNotScrapRow } from "@/lib/warranty-room/do-not-scrap";

/** Shared table + Excel/print actions for the do-not-scrap report, used by both the officer and branch-admin views. */
export function DoNotScrapTable({ branchName, rows }: { branchName: string; rows: DoNotScrapRow[] }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <p className="text-sm text-neutral-600">{rows.length} claim(s) - has parts, not flagged to scrap or already scrapped.</p>
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

      <div className="max-h-[36rem] overflow-y-auto rounded-lg border border-neutral-200 bg-white print:max-h-none print:overflow-visible">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500 print:static">
            <tr>
              <th className="px-4 py-2">Claim</th>
              <th className="px-4 py-2">Work order</th>
              <th className="px-4 py-2">VIN</th>
              <th className="px-4 py-2">Main part</th>
              <th className="px-4 py-2">Reception date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r) => (
              <tr key={r.claim_number}>
                <td className="px-4 py-2 text-neutral-900">{r.claim_number}</td>
                <td className="px-4 py-2 text-neutral-600">{r.work_order_no ?? "—"}</td>
                <td className="px-4 py-2 text-neutral-600">{r.vin ?? "—"}</td>
                <td className="px-4 py-2 text-neutral-600">{r.main_part_name ?? "—"}</td>
                <td className="px-4 py-2 text-neutral-600">{r.creation_date}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">
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
