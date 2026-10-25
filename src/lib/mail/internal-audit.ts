import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadMainPartNames } from "@/lib/claim-main-part";
import { loadInternalAuditReport } from "@/lib/internal-audit-report-data";
import { buildInternalAuditPdf, internalAuditPdfName } from "@/lib/internal-audit-pdf";
import { buildSampleWorkbook, type SampleExcelRow } from "@/lib/internal-audit-sample-excel";
import { composeMail } from "@/lib/mail/catalog";
import { ensureInternalAuditFolder, getDriveStatus } from "@/lib/google-drive";
import { dateLabel } from "@/lib/mail/template";
import { loadPeople, loadTemplates, recipientsFor } from "@/lib/mail/people";
import type { PlannedMail } from "@/lib/mail/plans";

const safeFile = (s: string) => s.replace(/[^\w.-]+/g, "_");

/** "Internal Audit Notice": to the branch's admins, with the Excel sheet of the selected claims attached. Null if the audit is for all branches. */
export async function planInternalAuditNotice(auditId: string): Promise<PlannedMail | null> {
  const admin = createAdminClient();
  const { data: audit } = await admin.from("self_audit_internal_audits").select("id, branch_id, audit_date").eq("id", auditId).maybeSingle();
  if (!audit?.branch_id) return null;

  // Announced claims only: the unannounced ones are asked for at the visit.
  const { data: internalClaims } = await admin.from("self_audit_internal_audit_claims").select("claim_id, sort_order").eq("internal_audit_id", auditId).eq("announced", true).order("sort_order");
  const claimIds = (internalClaims ?? []).map((c) => c.claim_id);
  const [{ data: claims }, people, templates, { data: branch }] = await Promise.all([
    claimIds.length ? admin.from("self_audit_claims").select("id, claim_number, work_order_no, vin, main_part_name, creation_date, repair_end_date").in("id", claimIds) : Promise.resolve({ data: [] }),
    loadPeople(),
    loadTemplates(),
    admin.from("self_audit_branches").select("name").eq("id", audit.branch_id).maybeSingle(),
  ]);
  const byId = new Map((claims ?? []).map((c) => [c.id, c]));
  const mainPartNames = await loadMainPartNames(admin, claimIds);
  const rows: SampleExcelRow[] = claimIds.flatMap((id) => {
    const c = byId.get(id);
    return c ? [{ claim_number: c.claim_number, work_order_no: c.work_order_no, vin: c.vin, main_part_name: mainPartNames.get(id) ?? c.main_part_name, creation_date: c.creation_date, repair_end_date: c.repair_end_date }] : [];
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

/**
 * "Internal Audit Results": to the branch's admins, with the results PDF attached, a button to the audit on the
 * portal and one to its Google Drive folder (Internal Audit / branch / month). Null until the audit is finalized
 * (or for all branches). A saved template without the {link} / {drive_link} lines gets them added at the end.
 */
export async function planInternalAuditResults(auditId: string, origin: string): Promise<(PlannedMail & { driveFolderId: string | null }) | null> {
  const admin = createAdminClient();
  const report = await loadInternalAuditReport(admin, auditId);
  if (!report?.audit.branch_id) return null;
  const branchId = report.audit.branch_id;
  const [people, templates, { data: audit }, drive] = await Promise.all([
    loadPeople(),
    loadTemplates(),
    admin.from("self_audit_internal_audits").select("audit_date, date_to, created_at").eq("id", auditId).maybeSingle(),
    getDriveStatus(),
  ]);
  const t = templates.results;

  let driveFolderId: string | null = null;
  if (drive && audit) {
    const iso = audit.audit_date ?? audit.date_to ?? audit.created_at;
    driveFolderId = await ensureInternalAuditFolder(branchId, report.branchName, `${iso.slice(5, 7)}-${iso.slice(0, 4)}`).catch(() => null);
  }
  const vars = {
    branch: report.branchName,
    score: String(report.overallScore),
    link: `${origin}/audit/internal-audit/${auditId}`,
    drive_link: driveFolderId ? `https://drive.google.com/drive/folders/${driveFolderId}` : "",
  };
  // Older saved templates do not have the link lines: add them just before the sign-off.
  let body = t.body;
  const extra = [
    !body.includes("{departments}") ? "{departments}" : null,
    !body.includes("{link}") ? "View the audit on the portal: {link}" : null,
    !body.includes("{drive_link}") && driveFolderId ? "Audit files on Google Drive: {drive_link}" : null,
  ].filter(Boolean);
  if (extra.length) {
    const parts = body.trim().split(/\n{2,}/);
    const signOff = parts.length > 1 ? parts.pop()! : "";
    body = [...parts, ...extra, signOff].filter(Boolean).join("\n\n");
  }
  // No Drive folder (Drive not connected): drop the Drive line rather than send an empty button.
  if (!driveFolderId) body = body.split(/\n{2,}/).filter((p) => !p.includes("{drive_link}")).join("\n\n");

  const mail = composeMail({ subject: t.subject, body }, vars, undefined, report.departmentScores.map((d) => ({ label: d.label, pct: d.pct })));
  return {
    driveFolderId,
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
