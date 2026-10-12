import { requireRole } from "@/lib/auth";
import { InternalAuditReportView } from "@/components/internal-audit-report-view";

export default async function InternalAuditReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("officer");
  const { id: auditId } = await params;

  return <InternalAuditReportView auditId={auditId} backHref="/admin/internal-audit" backLabel="Back to internal audits" />;
}
