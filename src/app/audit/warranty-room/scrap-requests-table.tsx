"use client";

import { generateScrapRequestsExcel } from "@/lib/warranty-room/scrap-requests-excel";

type Part = { part_no: string; part_name: string | null; quantity: number | null };
type Request = {
  id: string;
  claimNumber: string;
  workOrderNo: string | null;
  status: string;
  parts: Part[];
  lastComment: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  pending_branch: "Awaiting your submission",
  returned_to_branch: "Returned to you - please redo and resubmit",
  manufacturer_returned: "Returned by the manufacturer - please redo and resubmit",
};

/** Every pending claim's parts in one table (was a stack of per-claim bullet lists) - exportable, scrollable. */
export function ScrapRequestsTable({ branchName, requests }: { branchName: string; requests: Request[] }) {
  const rows = requests.flatMap((r) =>
    (r.parts.length > 0 ? r.parts : [{ part_no: "", part_name: null, quantity: null }]).map((p) => ({
      ...r,
      part_no: p.part_no,
      part_name: p.part_name,
      quantity: p.quantity,
    }))
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-600">
          {requests.length} claim(s), {rows.length} part row(s) pending.
        </p>
        <button
          type="button"
          onClick={() =>
            generateScrapRequestsExcel(
              branchName,
              rows.map((r) => ({
                claim_number: r.claimNumber,
                work_order_no: r.workOrderNo,
                status_label: STATUS_LABELS[r.status] ?? r.status,
                part_no: r.part_no || null,
                part_name: r.part_name,
                quantity: r.quantity,
              }))
            )
          }
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Download Excel
        </button>
      </div>

      <div className="max-h-[32rem] overflow-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="sticky top-0 bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2">Claim</th>
              <th className="px-4 py-2">Work order</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Part</th>
              <th className="px-4 py-2">Qty</th>
              <th className="px-4 py-2">Comment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r, i) => (
              <tr key={`${r.id}-${r.part_no}-${i}`}>
                <td className="px-4 py-2 text-neutral-900">{r.claimNumber}</td>
                <td className="px-4 py-2 text-neutral-600">{r.workOrderNo ?? "—"}</td>
                <td className="px-4 py-2 text-amber-700">{STATUS_LABELS[r.status] ?? r.status}</td>
                <td className="px-4 py-2 text-neutral-600">
                  {r.part_name ?? r.part_no ?? "—"} {r.part_no && r.part_name && `(${r.part_no})`}
                </td>
                <td className="px-4 py-2 text-neutral-600">{r.quantity ?? "—"}</td>
                <td className="px-4 py-2 text-neutral-600">{r.lastComment ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-neutral-400">
                  Nothing pending right now.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
