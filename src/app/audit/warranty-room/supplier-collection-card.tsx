"use client";

import { useActionState } from "react";
import { handOverSupplierCollection } from "./actions";
import { WarrantyRoomFileUploadField } from "@/components/warranty-room-file-upload-field";
import { generateSupplierCollectionExcel } from "@/lib/warranty-room/supplier-collection-excel";
import { generateSupplierCollectionPdf } from "@/lib/warranty-room/supplier-collection-pdf";

type Part = {
  claim_number: string;
  work_order_no: string | null;
  vin: string | null;
  part_no: string | null;
  part_name: string | null;
  quantity: number | null;
  main_labor_name: string | null;
  planned_pickup_date: string | null;
  raw_row: Record<string, unknown> | null;
  first_submit_date: string | null;
  repair_end_date: string | null;
  holding_period_days: number | null;
};

export function SupplierCollectionCard({
  collectionId,
  branchName,
  collectionDateLabel,
  parts,
}: {
  collectionId: string;
  branchName: string;
  collectionDateLabel: string;
  parts: Part[];
}) {
  const boundHandOver = handOverSupplierCollection.bind(null, collectionId);
  const [state, formAction, pending] = useActionState(boundHandOver, undefined);

  return (
    <div className="space-y-3 rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-neutral-900">Collection date: {collectionDateLabel}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              generateSupplierCollectionExcel(
                branchName,
                parts.map((p) => ({
                  claim_number: p.claim_number,
                  work_order_no: p.work_order_no,
                  vin: p.vin,
                  part_no: p.part_no,
                  part_name: p.part_name,
                  quantity: p.quantity,
                  main_labor_name: p.main_labor_name,
                  planned_pickup_date: p.planned_pickup_date,
                  raw_row: p.raw_row,
                  first_submit_date: p.first_submit_date,
                  repair_end_date: p.repair_end_date,
                  holding_period_days: p.holding_period_days,
                }))
              )
            }
            className="rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Download Excel
          </button>
          <button
            type="button"
            onClick={() =>
              generateSupplierCollectionPdf({
                branchName,
                collectionDateLabel,
                parts: parts.map((p) => ({
                  claimNumber: p.claim_number,
                  workOrderNo: p.work_order_no,
                  vin: p.vin,
                  partNo: p.part_no,
                  partName: p.part_name,
                  quantity: p.quantity,
                  mainLaborName: p.main_labor_name,
                })),
              })
            }
            className="rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Download PDF
          </button>
        </div>
      </div>

      <div className="max-h-80 overflow-auto rounded-md border border-neutral-100">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="sticky top-0 bg-neutral-50 text-left text-xs font-semibold tracking-wide text-neutral-500 uppercase border-b border-neutral-200">
            <tr>
              <th className="px-3 py-1.5">Claim</th>
              <th className="px-3 py-1.5">Work order</th>
              <th className="px-3 py-1.5">VIN</th>
              <th className="px-3 py-1.5">Part</th>
              <th className="px-3 py-1.5">Qty</th>
              <th className="px-3 py-1.5">First submit date</th>
              <th className="px-3 py-1.5">End of repair date</th>
              <th className="px-3 py-1.5">Holding period</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {parts.map((p, i) => (
              <tr key={`${p.claim_number}-${p.part_no}-${i}`}>
                <td className="px-3 py-1.5 text-neutral-900">{p.claim_number}</td>
                <td className="px-3 py-1.5 text-neutral-600">{p.work_order_no ?? "—"}</td>
                <td className="px-3 py-1.5 text-neutral-600">{p.vin ?? "—"}</td>
                <td className="px-3 py-1.5 text-neutral-600">
                  {p.part_name ?? p.part_no} {p.part_no && `(${p.part_no})`}
                </td>
                <td className="px-3 py-1.5 text-neutral-600">{p.quantity ?? "—"}</td>
                <td className="px-3 py-1.5 text-neutral-600">{p.first_submit_date ?? "—"}</td>
                <td className="px-3 py-1.5 text-neutral-600">{p.repair_end_date ?? "—"}</td>
                <td className="px-3 py-1.5 text-neutral-600">
                  {p.holding_period_days != null ? `${p.holding_period_days} day(s)` : "—"}
                </td>
              </tr>
            ))}
            {parts.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-center text-neutral-400">
                  No parts on file.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-neutral-500">
        Print the PDF for both representatives to sign, then upload the signed scan and a video of the hand-over.
      </p>

      <form action={formAction} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor={`branch-rep-${collectionId}`} className="text-xs font-medium text-neutral-700">
              Branch representative name
            </label>
            <input
              id={`branch-rep-${collectionId}`}
              name="branch_rep_name"
              type="text"
              required
              className="w-full rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={`supplier-rep-${collectionId}`} className="text-xs font-medium text-neutral-700">
              Supplier representative name
            </label>
            <input
              id={`supplier-rep-${collectionId}`}
              name="supplier_rep_name"
              type="text"
              required
              className="w-full rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-sm"
            />
          </div>
        </div>

        <WarrantyRoomFileUploadField
          label="Signed document"
          accept="application/pdf,image/*"
          required
          fieldName="signed_pdf_path"
          buildPath={(ext) => `${collectionId}/signed-${Date.now()}.${ext}`}
        />
        <WarrantyRoomFileUploadField
          label="Hand-over video"
          accept="video/*"
          required
          fieldName="video_path"
          buildPath={(ext) => `${collectionId}/handover-${Date.now()}.${ext}`}
        />

        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand shadow-sm shadow-brand/25 hover:shadow-md hover:shadow-brand/30 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Handing over..." : "Hand Over"}
        </button>
      </form>
    </div>
  );
}
