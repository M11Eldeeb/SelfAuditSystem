import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { computeInternalAuditScores } from "@/lib/internal-audit-scoring";
import { DEPARTMENT_LABELS } from "@/lib/departments";
import { scoreBadgeClasses } from "@/lib/score-color";
import { DownloadReportButton } from "./download-report-button";
import type { DepartmentId } from "@/lib/supabase/types";

export default async function InternalAuditReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("officer");
  const { id: auditId } = await params;
  const supabase = await createClient();

  const { data: audit } = await supabase.from("self_audit_internal_audits").select("*").eq("id", auditId).single();
  if (!audit || audit.status !== "finalized") notFound();

  const [{ data: branch }, { data: questions }, { data: internalClaims }, { data: branchAnswers }, { data: remarks }] =
    await Promise.all([
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
  const branchAnswersByQuestion = new Map<string, string | null>(
    (branchAnswers ?? []).map((a) => [a.question_id, a.answer_value])
  );

  const { overallScore, departmentScores, checkpointScores } = computeInternalAuditScores(
    questions ?? [],
    claimAnswersByQuestion,
    branchAnswersByQuestion
  );

  const questionById = new Map((questions ?? []).map((q) => [q.id, q]));
  const recommendations = checkpointScores
    .filter((c) => c.pct != null && c.pct < 80)
    .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0))
    .map((c) => ({
      dept: DEPARTMENT_LABELS[(c.departmentId as DepartmentId) ?? "reception"] ?? c.departmentId,
      checkpoint: c.label,
      pct: c.pct ?? 0,
      text: questionById.get(c.questionId)?.remediation_suggestion ?? "No specific recommendation on file.",
    }));

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/internal-audit" className="text-sm text-neutral-500 hover:text-neutral-800">
            &larr; Back to internal audits
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">
            Internal Audit Report - {branchName}
          </h1>
          <p className="text-sm text-neutral-500">
            {auditDateLabel} &middot; Auditor: {auditorName || "—"} &middot; Service manager:{" "}
            {audit.manager_name || "—"}
          </p>
        </div>
        <DownloadReportButton
          data={{
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
            closingStatement: audit.closing_statement ?? "",
          }}
        />
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-lg font-semibold ${scoreBadgeClasses(overallScore)}`}>
            {overallScore}%
          </span>
          <span className="text-sm text-neutral-500">Overall score</span>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Department scores</h2>
        <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4">
          {departmentScores.map((d) => (
            <div key={d.departmentId} className="flex items-center gap-3">
              <span className="w-48 shrink-0 text-sm text-neutral-900">{d.label}</span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className={`h-full rounded-full ${d.pct != null && d.pct >= 90 ? "bg-emerald-500" : d.pct != null && d.pct >= 75 ? "bg-amber-500" : "bg-red-500"}`}
                  style={{ width: `${Math.min(d.pct ?? 0, 100)}%` }}
                />
              </div>
              <span className="w-16 text-right text-sm font-medium text-neutral-900">
                {d.pct != null ? `${d.pct}%` : "—"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Recommendations</h2>
        {recommendations.length === 0 ? (
          <p className="text-sm text-neutral-500">No open findings below the 80% threshold.</p>
        ) : (
          <div className="space-y-2">
            {recommendations.map((r, i) => (
              <div key={i} className="rounded-lg border border-neutral-200 bg-white p-4">
                <p className="text-sm font-medium text-neutral-900">
                  {r.dept} &middot; {r.checkpoint} ({r.pct}%)
                </p>
                <p className="mt-1 text-sm text-neutral-600">{r.text}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {departmentRemarks.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-neutral-900">Auditor remarks</h2>
          <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4">
            {departmentRemarks.map((r, i) => (
              <div key={i}>
                <p className="text-sm font-medium text-neutral-900">{r.label}</p>
                <p className="text-sm text-neutral-600">{r.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Closing statement</h2>
        <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-700">
          {audit.closing_statement || "—"}
        </p>
      </section>
    </div>
  );
}
