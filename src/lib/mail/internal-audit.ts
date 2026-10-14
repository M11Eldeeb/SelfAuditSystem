import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadInternalAuditReport } from "@/lib/internal-audit-report-data";
import { buildInternalAuditPdf, internalAuditPdfName } from "@/lib/internal-audit-pdf";
import { buildSampleWorkbook, type SampleExcelRow } from "@/lib/internal-audit-sample-excel";
import { composeMail } from "@/lib/mail/catalog";
import { dateLabel } from "@/lib/mail/template";
import { loadPeople, loadTemplates, recipientsFor } from "@/lib/mail/people";
import type { PlannedMail } from "@/lib/mail/plans";

const safeFile = (s: string) => s.replace(/[^\w.-]+/g, "_");

/** "Internal Audit Notice": to the branch's admins, with the Excel sheet of the selected claims attached. Null if the audit is for all branches. */
export async function planInternalAuditNotice(auditId: string): Promise<PlannedMail | null> {
  const admin = createAdminClient();
  const { data: audit } = await admin.from("self_audit_internal_audits").select("id, branch_id, audit_date").eq("id", auditId).maybeSingle();
  if (!audit?.branch_id) return null;

  const { data: internalClaims } = await admin.from("self_audit_internal_audit_claims").select("claim_id, sort_order").eq("internal_audit_id", auditId).order("sort_order");
  const claimIds = (internalClaims ?? []).map((c) => c.claim_id);
  const [{ data: claims }, people, templates, { data: branch }] = await Promise.all([
    claimIds.length ? admin.from("self_audit_claims").select("id, claim_number, work_order_no, vin, main_part_name, creation_date, repair_end_date").in("id", claimIds) : Promise.resolve({ data: [] }),
    loadPeople(),
    loadTemplates(),
    admin.from("self_audit_branches").select("name").eq("id", audit.branch_id).maybeSingle(),
  ]);
  const byId = new Map((claims ?? []).map((c) => [c.id, c]));
  const rows: SampleExcelRow[] = claimIds.flatMap((id) => {
    const c = byId.get(id);
    return c ? [{ claim_number: c.claim_number, work_order_no: c.work_order_no, vin: c.vin, main_part_name: c.main_part_name, creation_date: c.creation_date, repair_end_date: c.repair_end_date }] : [];
  });
  if (rows.length === 0) return null;

  const branchName = branch?.name ?? "Branch";
  const t = templates.notice;
  const n = rows.length;
  const mail = composeMail(t, {
    branch: branchName,
    claims: `${n} ${n === 1 ? "claim" : "claims"}`,
    is: n === 1 ? "is" : "are",
    on_date: audit.audit_date ? ` on ${dateLabel(`${audit.audit_date}T00:00:00Z`)}` : "",
  });
  return {
    kind: "internal-audit-notice",
    key: `internal-audit-notice:${auditId}`,
    branchId: audit.branch_id,
    branchName,
    ...recipientsFor(t, people, { to: people.adminsByBranch.get(audit.branch_id) ?? [], branchId: audit.branch_id }),
    ...mail,
    label: "Internal audit notice",
    attachments: [
      {
        filename: `Internal_Audit_Claims_${safeFile(branchName)}.xlsx`,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        data: Buffer.from(await buildSampleWorkbook(rows)),
      },
    ],
  };
}

/** "Internal Audit Results": to the branch's admins, with the results PDF attached. Null until the audit is finalized (or for all branches). */
export async function planInternalAuditResults(auditId: string): Promise<PlannedMail | null> {
  const admin = createAdminClient();
  const report = await loadInternalAuditReport(admin, auditId);
  if (!report?.audit.branch_id) return null;
  const branchId = report.audit.branch_id;
  const [people, templates] = await Promise.all([loadPeople(), loadTemplates()]);
  const t = templates.results;

  const mail = composeMail(t, { branch: report.branchName, score: String(report.overallScore) });
  return {
    kind: "internal-audit-results",
    key: `internal-audit-results:${auditId}`,
    branchId,
    branchName: report.branchName,
    ...recipientsFor(t, people, { to: people.adminsByBranch.get(branchId) ?? [], branchId }),
    ...mail,
    label: "Internal audit results",
    attachments: [{ filename: internalAuditPdfName(report.pdf), mimeType: "application/pdf", data: Buffer.from(buildInternalAuditPdf(report.pdf).output("arraybuffer")) }],
  };
}
