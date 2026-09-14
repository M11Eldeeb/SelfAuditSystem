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
    <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
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
                }))
              )
            }
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
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
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Download PDF
          </button>
        </div>
      </div>

      <ul className="list-disc space-y-0.5 pl-4 text-sm text-neutral-700">
        {parts.map((p, i) => (
          <li key={`${p.claim_number}-${p.part_no}-${i}`}>
            {p.part_name ?? p.part_no} ({p.part_no}){p.quantity != null && ` × ${p.quantity}`} &middot; Claim {p.claim_number}
            {p.work_order_no && ` · WO ${p.work_order_no}`}
          </li>
        ))}
      </ul>

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
              className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
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
              className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
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
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Handing over..." : "Hand Over"}
        </button>
      </form>
    </div>
  );
}
