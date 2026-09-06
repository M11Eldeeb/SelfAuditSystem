import { requireRole } from "@/lib/auth";
import { InternalAuditReportView } from "@/components/internal-audit-report-view";

export default async function BranchInternalAuditReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("branch_admin");
  const { id: auditId } = await params;

  // RLS scopes self_audit_internal_audits (and its detail tables) to this
  // branch admin's own branch and finalized audits only - notFound() inside
  // InternalAuditReportView covers both "doesn't exist" and "not this branch".
  return (
    <InternalAuditReportView
      auditId={auditId}
      backHref="/audit/internal-audit"
      backLabel="Back to internal audit results"
      showEmailButton={false}
    />
  );
}
