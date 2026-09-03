import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { InternalAuditFinalizeForm } from "./internal-audit-finalize-form";
import { computeInternalAuditScores, defaultClosingStatement } from "@/lib/internal-audit-scoring";

export default async function InternalAuditFinalizePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const officer = await requireRole("officer");
  const { id: auditId } = await params;
  const supabase = await createClient();

  const { data: audit } = await supabase.from("self_audit_internal_audits").select("status").eq("id", auditId).single();
  if (!audit) notFound();
  if (audit.status === "finalized") redirect(`/admin/internal-audit/${auditId}/report`);

  const [{ data: questions }, { data: internalClaims }, { data: branchAnswers }] = await Promise.all([
    supabase.from("self_audit_audit_questions").select("*").in("scope", ["claim", "parts", "branch"]),
    supabase.from("self_audit_internal_audit_claims").select("id").eq("internal_audit_id", auditId),
    supabase.from("self_audit_internal_audit_branch_answers").select("question_id, answer_value").eq("internal_audit_id", auditId),
  ]);

  const internalClaimIds = (internalClaims ?? []).map((c) => c.id);
  const { data: claimAnswers } =
    internalClaimIds.length > 0
      ? await supabase
          .from("self_audit_internal_audit_answers")
          .select("question_id, answer_value")
          .in("internal_audit_claim_id", internalClaimIds)
      : { data: [] };

  const claimAnswersByQuestion = new Map<string, string[]>();
  (claimAnswers ?? []).forEach((a) => {
    const list = claimAnswersByQuestion.get(a.question_id) ?? [];
    if (a.answer_value != null) list.push(a.answer_value);
    claimAnswersByQuestion.set(a.question_id, list);
  });
  const branchAnswersByQuestion = new Map<string, string | null>(
    (branchAnswers ?? []).map((a) => [a.question_id, a.answer_value])
  );

  const { overallScore } = computeInternalAuditScores(questions ?? [], claimAnswersByQuestion, branchAnswersByQuestion);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/admin/internal-audit/${auditId}/branch-ops`} className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to Branch Operation
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">Finalize internal audit</h1>
        <p className="text-sm text-neutral-500">Current score: {overallScore}%. Finalizing locks all answers.</p>
      </div>

      <InternalAuditFinalizeForm
        auditId={auditId}
        defaultAuditorName={officer.full_name ?? ""}
        defaultClosingStatement={defaultClosingStatement(overallScore)}
      />
    </div>
  );
}
