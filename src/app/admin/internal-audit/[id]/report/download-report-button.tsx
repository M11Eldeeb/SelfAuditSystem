"use client";

import { generateInternalAuditPdf, type InternalAuditPdfData } from "@/lib/internal-audit-pdf";

function buildResultsEmail({
  branchAdminEmail,
  branchLabel,
  overallScore,
  auditorName,
}: {
  branchAdminEmail: string;
  branchLabel: string;
  overallScore: number;
  auditorName: string;
}): string {
  const subject = `Internal Audit Results - ${branchLabel}`;
  const body = [
    `Dear ${branchLabel} team,`,
    "",
    `The internal audit for your branch has been completed with an overall score of ${overallScore}%.`,
    "Please find the results report attached for your review.",
    "",
    "Best regards,",
    auditorName || "",
  ].join("\n");
  return `mailto:${encodeURIComponent(branchAdminEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function ReportActions({
  data,
  branchAdminEmail,
  showEmailButton = true,
}: {
  data: InternalAuditPdfData;
  branchAdminEmail: string | null;
  showEmailButton?: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => generateInternalAuditPdf(data)}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
        >
          Download PDF
        </button>
        {showEmailButton && (
          <button
            type="button"
            disabled={!branchAdminEmail}
            title={branchAdminEmail ? undefined : "No branch admin email found for this branch."}
            onClick={() => {
              if (!branchAdminEmail) return;
              generateInternalAuditPdf(data);
              window.location.href = buildResultsEmail({
                branchAdminEmail,
                branchLabel: data.branchName,
                overallScore: data.overallScore,
                auditorName: data.auditorName,
              });
            }}
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send results to branch admin
          </button>
        )}
      </div>
      {showEmailButton && (
        <p className="max-w-xs text-right text-xs text-neutral-500">
          Downloads the PDF and opens your email app - attach the downloaded file before sending, email
          links can&apos;t attach files automatically.
        </p>
      )}
    </div>
  );
}
