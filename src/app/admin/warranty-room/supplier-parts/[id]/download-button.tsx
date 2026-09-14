"use client";

import { generateSupplierCollectionExcel, type SupplierCollectionExcelRow } from "@/lib/warranty-room/supplier-collection-excel";

export function DownloadExcelButton({ branchName, rows }: { branchName: string; rows: SupplierCollectionExcelRow[] }) {
  return (
    <button
      type="button"
      onClick={() => generateSupplierCollectionExcel(branchName, rows)}
      className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
    >
      Download Excel
    </button>
  );
}
