import { requireRole } from "@/lib/auth";
import { InternalAuditReportView } from "@/components/internal-audit-report-view";
import { InternalAuditFilesSection } from "@/components/internal-audit-files/files-section";
import { ReopenAuditButton } from "./reopen-audit-button";

export default async function InternalAuditReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const officer = await requireRole("officer");
  const { id: auditId } = await params;

  return (
    <div className="space-y-6">
      {!officer.viewOnly && <ReopenAuditButton auditId={auditId} />}
      <InternalAuditReportView auditId={auditId} backHref="/admin/internal-audit" backLabel="Back to internal audits" />
      <InternalAuditFilesSection auditId={auditId} />
    </div>
  );
}
