"use client";

import { generateInternalAuditPdf, type InternalAuditPdfData } from "@/lib/internal-audit-pdf";

export function DownloadReportButton({ data }: { data: InternalAuditPdfData }) {
  return (
    <button
      type="button"
      onClick={() => generateInternalAuditPdf(data)}
      className="shrink-0 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
    >
      Download PDF
    </button>
  );
}
