import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadInternalAuditReport } from "@/lib/internal-audit-report-data";
import { buildInternalAuditPdf, internalAuditPdfName } from "@/lib/internal-audit-pdf";
import { buildSampleWorkbook, type SampleExcelRow } from "@/lib/internal-audit-sample-excel";
import { dateLabel, renderMail } from "@/lib/mail/template";
import { loadPeople, selfAuditCc, type PlannedMail } from "@/lib/mail/plans";

/** The wording of the two internal-audit mails (shared by real sends and the sample sends). */
export const internalAuditContent = {
  notice(v: { branch: string; claims: number; auditDate: string | null }) {
    return renderMail(
      [
        {
          type: "p",
          text: `The Warranty department will conduct an internal audit${v.auditDate ? ` on ${v.auditDate}` : ""}. The ${v.claims} claim${v.claims === 1 ? "" : "s"} selected ${v.claims === 1 ? "is" : "are"} in the attached Excel sheet. Please have the original job cards in order, parts and documentation ready for review.`,
        },
      ],
      { greeting: `Dear ${v.branch} team,` }
    );
  },
  results(v: { branch: string; score: number }) {
    return renderMail(
      [{ type: "p", text: `The internal audit for your branch is complete, with an overall score of ${v.score}%. The full report is attached.` }],
      { greeting: `Dear ${v.branch} team,` }
    );
  },
};

const safeFile = (s: string) => s.replace(/[^\w.-]+/g, "_");

/** "Internal Audit Notice": to the branch's admins, with the Excel sheet of the selected claims attached. Null if the audit is for all branches. */
export async function planInternalAuditNotice(auditId: string): Promise<PlannedMail | null> {
  const admin = createAdminClient();
  const { data: audit } = await admin.from("self_audit_internal_audits").select("id, branch_id, audit_date").eq("id", auditId).maybeSingle();
  if (!audit?.branch_id) return null;

  const { data: internalClaims } = await admin.from("self_audit_internal_audit_claims").select("claim_id, sort_order").eq("internal_audit_id", auditId).order("sort_order");
  const claimIds = (internalClaims ?? []).map((c) => c.claim_id);
  const [{ data: claims }, people, { data: branch }] = await Promise.all([
    claimIds.length ? admin.from("self_audit_claims").select("id, claim_number, work_order_no, vin, main_part_name, creation_date, repair_end_date").in("id", claimIds) : Promise.resolve({ data: [] }),
    loadPeople(),
    admin.from("self_audit_branches").select("name").eq("id", audit.branch_id).maybeSingle(),
  ]);
  const byId = new Map((claims ?? []).map((c) => [c.id, c]));
  const rows: SampleExcelRow[] = claimIds.flatMap((id) => {
    const c = byId.get(id);
    return c ? [{ claim_number: c.claim_number, work_order_no: c.work_order_no, vin: c.vin, main_part_name: c.main_part_name, creation_date: c.creation_date, repair_end_date: c.repair_end_date }] : [];
  });
  if (rows.length === 0) return null;

  const branchName = branch?.name ?? "Branch";
  const { text, html } = internalAuditContent.notice({ branch: branchName, claims: rows.length, auditDate: audit.audit_date ? dateLabel(`${audit.audit_date}T00:00:00Z`) : null });
  return {
    kind: "internal-audit-notice",
    key: `internal-audit-notice:${auditId}`,
    branchId: audit.branch_id,
    branchName,
    to: people.adminsByBranch.get(audit.branch_id) ?? [],
    cc: selfAuditCc(people, audit.branch_id),
    subject: `Internal Audit Notice - ${branchName}`,
    text,
    html,
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
  const people = await loadPeople();

  const { text, html } = internalAuditContent.results({ branch: report.branchName, score: report.overallScore });
  return {
    kind: "internal-audit-results",
    key: `internal-audit-results:${auditId}`,
    branchId,
    branchName: report.branchName,
    to: people.adminsByBranch.get(branchId) ?? [],
    cc: selfAuditCc(people, branchId),
    subject: `Internal Audit Results - ${report.branchName}`,
    text,
    html,
    label: "Internal audit results",
    attachments: [{ filename: internalAuditPdfName(report.pdf), mimeType: "application/pdf", data: Buffer.from(buildInternalAuditPdf(report.pdf).output("arraybuffer")) }],
  };
}
