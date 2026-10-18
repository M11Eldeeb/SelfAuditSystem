import { requireRole } from "@/lib/auth";
import { InternalAuditReportView } from "@/components/internal-audit-report-view";
import { InternalAuditFilesSection } from "@/components/internal-audit-files/files-section";

export default async function InternalAuditReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("officer");
  const { id: auditId } = await params;

  return (
    <div className="space-y-6">
      <InternalAuditReportView auditId={auditId} backHref="/admin/internal-audit" backLabel="Back to internal audits" />
      <InternalAuditFilesSection auditId={auditId} />
    </div>
  );
}
