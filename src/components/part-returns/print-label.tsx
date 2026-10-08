"use client";

import { useEffect } from "react";
import { requestLabel, type PartReturn, type PartReturnItem } from "@/lib/part-returns";

/**
 * A4 sheet to attach to the shipment box: request number, branch, and the
 * selected claims with their parts. Opens the browser print dialog on load
 * ("Save as PDF" to keep a copy); app chrome is hidden in print.
 */
export function PrintLabel({
  request,
  branchName,
  items,
}: {
  request: Pick<PartReturn, "request_no" | "created_at" | "branch_waybill">;
  branchName: string;
  items: PartReturnItem[];
}) {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, []);

  const byClaim = new Map<string, PartReturnItem[]>();
  for (const i of items) byClaim.set(i.claim_number, [...(byClaim.get(i.claim_number) ?? []), i]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 bg-white p-6 text-neutral-900 print:max-w-none print:p-0">
      <div className="flex items-center justify-between gap-4 print:hidden">
        <p className="text-sm text-neutral-600">Choose “Save as PDF” in the print dialog to keep a copy.</p>
        <button type="button" onClick={() => window.print()} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
          Print
        </button>
      </div>

      <div className="flex items-start justify-between border-b-2 border-neutral-900 pb-3">
        <div>
          <div className="text-xs font-semibold tracking-widest text-neutral-500 uppercase">Warranty part return</div>
          <div className="text-3xl font-bold">{requestLabel(request.request_no)}</div>
        </div>
        <div className="text-right text-sm">
          <div className="font-semibold">{branchName}</div>
          <div>Requested {new Date(request.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Riyadh" })}</div>
          {request.branch_waybill && <div>Waybill: {request.branch_waybill}</div>}
        </div>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-400 text-left text-xs uppercase">
            <th className="py-1.5 pr-3">Claim no.</th>
            <th className="py-1.5 pr-3">Work order</th>
            <th className="py-1.5 pr-3">Part no.</th>
            <th className="py-1.5 pr-3">Part name</th>
            <th className="py-1.5 text-right">Qty</th>
          </tr>
        </thead>
        <tbody>
          {[...byClaim.entries()].map(([claim, parts]) =>
            parts.map((p, idx) => (
              <tr key={p.id} className={`border-b border-neutral-200 ${idx === 0 ? "" : "text-neutral-800"}`}>
                <td className="py-1.5 pr-3 font-semibold">{idx === 0 ? claim : ""}</td>
                <td className="py-1.5 pr-3">{idx === 0 ? (p.work_order_no ?? "") : ""}</td>
                <td className="py-1.5 pr-3 font-mono">{p.part_no ?? "—"}</td>
                <td className="py-1.5 pr-3">{p.part_name ?? "—"}</td>
                <td className="py-1.5 text-right">{p.quantity ?? 1}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="flex justify-between pt-6 text-xs text-neutral-600">
        <span>
          {byClaim.size} claims · {items.length} parts
        </span>
        <span>Packed by: ____________________ Date: ____________</span>
      </div>
    </div>
  );
}
