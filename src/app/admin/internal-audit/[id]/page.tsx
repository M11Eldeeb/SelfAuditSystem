import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { InternalAuditClaimForm } from "./internal-audit-claim-form";
import { DEPARTMENT_ORDER, DEPARTMENT_LABELS } from "@/lib/departments";

export default async function InternalAuditClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ claim?: string }>;
}) {
  await requireRole("officer");
  const { id: auditId } = await params;
  const supabase = await createClient();

  const { data: audit } = await supabase.from("self_audit_internal_audits").select("*").eq("id", auditId).single();
  if (!audit) notFound();
  if (audit.status === "finalized") redirect(`/admin/internal-audit/${auditId}/report`);

  const { data: internalClaims } = await supabase
    .from("self_audit_internal_audit_claims")
    .select("id, claim_id, sort_order")
    .eq("internal_audit_id", auditId)
    .order("sort_order");

  if (!internalClaims || internalClaims.length === 0) notFound();

  const { claim: claimParam } = await searchParams;
  const requestedIndex = Number(claimParam ?? 0);
  const currentIndex = Math.min(Math.max(isNaN(requestedIndex) ? 0 : requestedIndex, 0), internalClaims.length - 1);
  const current = internalClaims[currentIndex];

  const [{ data: claim }, { data: questions }, { data: existingAnswers }, { data: note }] = await Promise.all([
    supabase.from("self_audit_claims").select("*").eq("id", current.claim_id).single(),
    supabase.from("self_audit_audit_questions").select("*").in("scope", ["claim", "parts"]).order("sort_order"),
    supabase.from("self_audit_internal_audit_answers").select("question_id, answer_value").eq("internal_audit_claim_id", current.id),
    supabase.from("self_audit_internal_audit_notes").select("note_text").eq("internal_audit_claim_id", current.id).maybeSingle(),
  ]);

  const answersMap = new Map((existingAnswers ?? []).map((a) => [a.question_id, a.answer_value]));

  const questionGroups = DEPARTMENT_ORDER.filter((dept) => dept !== "branchops")
    .map((dept) => ({
      departmentId: dept,
      label: DEPARTMENT_LABELS[dept],
      questions: (questions ?? []).filter((q) => q.department === dept),
    }))
    .filter((g) => g.questions.length > 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/internal-audit" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to internal audits
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">
          Claim {claim?.claim_number ?? current.claim_id}
          {claim?.work_order_no && (
            <span className="ml-2 text-lg font-medium text-neutral-500">&middot; WO {claim.work_order_no}</span>
          )}
        </h1>
        <p className="text-sm text-neutral-500">
          Claim {currentIndex + 1} of {internalClaims.length}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-neutral-200 bg-white p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-neutral-500">VIN</dt>
          <dd className="text-neutral-900">{claim?.vin ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Mileage</dt>
          <dd className="text-neutral-900">{claim?.mileage ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Creation date</dt>
          <dd className="text-neutral-900">{claim?.creation_date ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Repair end date</dt>
          <dd className="text-neutral-900">{claim?.repair_end_date ?? "—"}</dd>
        </div>
      </div>

      <InternalAuditClaimForm
        auditId={auditId}
        internalAuditClaimId={current.id}
        claim={claim ?? null}
        currentIndex={currentIndex}
        totalClaims={internalClaims.length}
        questionGroups={questionGroups}
        answers={answersMap}
        noteText={note?.note_text ?? ""}
        locked={false}
      />
    </div>
  );
}
