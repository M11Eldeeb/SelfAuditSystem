import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeInternalAuditScores } from "@/lib/internal-audit-scoring";
import { DEPARTMENT_LABELS } from "@/lib/departments";
import type { InternalAuditPdfData } from "@/lib/internal-audit-pdf";
import type { Database, DepartmentId } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;
type AuditRow = Database["public"]["Tables"]["self_audit_internal_audits"]["Row"];

export type InternalAuditReport = {
  audit: AuditRow;
  branchName: string;
  overallScore: number;
  departmentScores: ReturnType<typeof computeInternalAuditScores>["departmentScores"];
  recommendations: { dept: string; checkpoint: string; pct: number; text: string }[];
  departmentRemarks: { label: string; text: string }[];
  /** Exactly what the PDF shows. */
  pdf: InternalAuditPdfData;
};

/**
 * Everything the report of a FINALIZED internal audit shows, in one place: the report page reads it with the
 * viewer's own access, and the "send results" e-mail reads it with the service role to build the same PDF.
 * Null if the audit does not exist (for the client's access) or is not finalized yet.
 */
export async function loadInternalAuditReport(supabase: Client, auditId: string): Promise<InternalAuditReport | null> {
  const { data: audit } = await supabase.from("self_audit_internal_audits").select("*").eq("id", auditId).maybeSingle();
  if (!audit || audit.status !== "finalized") return null;

  const [{ data: branch }, { data: questions }, { data: internalClaims }, { data: branchAnswers }, { data: remarks }] = await Promise.all([
    audit.branch_id ? supabase.from("self_audit_branches").select("name").eq("id", audit.branch_id).single() : Promise.resolve({ data: null }),
    supabase.from("self_audit_audit_questions").select("*").in("scope", ["claim", "parts", "branch"]),
    supabase.from("self_audit_internal_audit_claims").select("id, claim_id").eq("internal_audit_id", auditId),
    supabase.from("self_audit_internal_audit_branch_answers").select("question_id, answer_value").eq("internal_audit_id", auditId),
    supabase.from("self_audit_internal_audit_department_remarks").select("department_id, remark_text").eq("internal_audit_id", auditId),
  ]);

  const internalClaimIds = (internalClaims ?? []).map((c) => c.id);
  const [{ data: claimAnswers }, { data: notes }, { data: claims }] = await Promise.all([
    internalClaimIds.length > 0
      ? supabase.from("self_audit_internal_audit_answers").select("question_id, answer_value").in("internal_audit_claim_id", internalClaimIds)
      : Promise.resolve({ data: [] }),
    internalClaimIds.length > 0
      ? supabase.from("self_audit_internal_audit_notes").select("internal_audit_claim_id, note_text").in("internal_audit_claim_id", internalClaimIds)
      : Promise.resolve({ data: [] }),
    internalClaimIds.length > 0
      ? supabase.from("self_audit_claims").select("id, vin, claim_number").in(
          "id",
          (internalClaims ?? []).map((c) => c.claim_id)
        )
      : Promise.resolve({ data: [] }),
  ]);

  const claimAnswersByQuestion = new Map<string, string[]>();
  (claimAnswers ?? []).forEach((a) => {
    const list = claimAnswersByQuestion.get(a.question_id) ?? [];
    if (a.answer_value != null) list.push(a.answer_value);
    claimAnswersByQuestion.set(a.question_id, list);
  });
  const branchAnswersByQuestion = new Map<string, string | null>((branchAnswers ?? []).map((a) => [a.question_id, a.answer_value]));

  const { overallScore, departmentScores, checkpointScores } = computeInternalAuditScores(questions ?? [], claimAnswersByQuestion, branchAnswersByQuestion);

  // Reviewed, edited and possibly trimmed by the officer at finalize time (see the finalize form) - frozen
  // there rather than recomputed here, so an edit or removal made before finalizing sticks on the report.
  const recommendations = audit.recommendations ?? [];

  const claimById = new Map((claims ?? []).map((c) => [c.id, c]));
  const claimIdByInternalClaimId = new Map((internalClaims ?? []).map((c) => [c.id, c.claim_id]));
  const claimNotes = (notes ?? [])
    .filter((n) => n.note_text && n.note_text.trim())
    .map((n) => {
      const claim = claimById.get(claimIdByInternalClaimId.get(n.internal_audit_claim_id) ?? "");
      return { vin: claim?.vin ?? "—", claimNumber: claim?.claim_number ?? "—", note: n.note_text ?? "" };
    });

  const departmentRemarks = (remarks ?? [])
    .filter((r) => r.remark_text && r.remark_text.trim())
    .map((r) => ({ label: DEPARTMENT_LABELS[r.department_id] ?? r.department_id, text: r.remark_text ?? "" }));

  const branchName = branch?.name ?? "All branches";
  const auditorName = audit.auditor_name ?? "";
  const auditDateLabel = (audit.finalized_at ?? audit.created_at).slice(0, 10);

  return {
    audit,
    branchName,
    overallScore,
    departmentScores,
    recommendations,
    departmentRemarks,
    pdf: {
      auditName: audit.name || `Internal Audit Report - ${branchName}`,
      branchName,
      auditDateLabel,
      auditorName,
      managerName: audit.manager_name ?? "",
      overallScore,
      departmentScores: departmentScores.map((d) => ({ label: d.label, pct: d.pct })),
      checkpointScores: checkpointScores.map((c) => ({
        departmentLabel: DEPARTMENT_LABELS[(c.departmentId as DepartmentId) ?? "reception"] ?? c.departmentId,
        label: c.label,
        pct: c.pct,
      })),
      departmentRemarks,
      recommendations,
      claimNotes,
      branchOpsNote: audit.branch_ops_note ?? "",
      closingStatement: audit.closing_statement ?? "",
    },
  };
}
