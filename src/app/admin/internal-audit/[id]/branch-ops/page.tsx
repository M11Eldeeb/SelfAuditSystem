import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { InternalAuditBranchOpsForm } from "./internal-audit-branch-ops-form";

export default async function InternalAuditBranchOpsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("officer");
  const { id: auditId } = await params;
  const supabase = await createClient();

  const { data: audit } = await supabase.from("self_audit_internal_audits").select("status").eq("id", auditId).single();
  if (!audit) notFound();
  if (audit.status === "finalized") redirect(`/admin/internal-audit/${auditId}/report`);

  const [{ data: questions }, { data: answers }] = await Promise.all([
    supabase.from("self_audit_audit_questions").select("*").eq("scope", "branch").order("sort_order"),
    supabase.from("self_audit_internal_audit_branch_answers").select("question_id, answer_value").eq("internal_audit_id", auditId),
  ]);

  const answersMap = new Map((answers ?? []).map((a) => [a.question_id, a.answer_value]));

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/admin/internal-audit/${auditId}?claim=0`} className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to claims
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">Branch Operation</h1>
        <p className="text-sm text-neutral-500">Asked once for this internal audit, not tied to a specific claim.</p>
      </div>

      <InternalAuditBranchOpsForm auditId={auditId} questions={questions ?? []} answers={answersMap} locked={false} />
    </div>
  );
}
