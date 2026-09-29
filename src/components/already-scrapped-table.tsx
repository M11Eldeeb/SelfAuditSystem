"use client";

import { generateAlreadyScrappedExcel } from "@/lib/warranty-room/already-scrapped-excel";
import type { AlreadyScrappedRow } from "@/lib/warranty-room/already-scrapped";

const STATUS_LABELS: Record<string, string> = {
  presumed_scrapped: "Presumed scrapped",
  scrapped: "Scrapped (video submitted)",
};

export function AlreadyScrappedTable({ branchName, rows }: { branchName: string; rows: AlreadyScrappedRow[] }) {
  const claimCount = new Set(rows.map((r) => r.claim_number)).size;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <p className="text-sm text-neutral-600">
          {claimCount} claim(s), {rows.length} part row(s) - no longer pending.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => generateAlreadyScrappedExcel(branchName, rows)}
            className="rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Download Excel
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Print
          </button>
        </div>
      </div>

      <div className="max-h-[36rem] overflow-auto rounded-xl border border-neutral-200/70 bg-white shadow-sm print:max-h-none print:overflow-visible">
        <table className="w-full min-w-[64rem] text-sm">
          <thead className="sticky top-0 bg-neutral-50 text-left text-xs font-semibold tracking-wide text-neutral-500 uppercase border-b border-neutral-200 print:static">
            <tr>
              <th className="px-4 py-2">Claim</th>
              <th className="px-4 py-2">Work order</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Part</th>
              <th className="px-4 py-2">Qty</th>
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
                <td className="px-4 py-2 text-neutral-600">{STATUS_LABELS[r.status] ?? r.status}</td>
                <td className="px-4 py-2 text-neutral-600">
                  {r.part_name ?? "—"} {r.part_no && `(${r.part_no})`}
                </td>
                <td className="px-4 py-2 text-neutral-600">{r.quantity ?? "—"}</td>
                <td className="px-4 py-2 text-neutral-600">{r.first_submit_date ?? "—"}</td>
                <td className="px-4 py-2 text-neutral-600">{r.repair_end_date ?? "—"}</td>
                <td className="px-4 py-2 text-neutral-600">
                  {r.holding_period_days != null ? `${r.holding_period_days} day(s)` : "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-neutral-400">
                  Nothing scrapped yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
