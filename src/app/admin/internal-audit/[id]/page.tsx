import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { InternalAuditClaimForm } from "./internal-audit-claim-form";
import { WorkOrderSearch } from "./work-order-search";
import { DEPARTMENT_ORDER, DEPARTMENT_LABELS } from "@/lib/departments";

export default async function InternalAuditClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ claim?: string; mode?: string }>;
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

  const { claim: claimParam, mode: modeParam } = await searchParams;
  const mode: "documents" | "parts" = modeParam === "parts" ? "parts" : "documents";
  const requestedIndex = Number(claimParam ?? 0);
  const currentIndex = Math.min(Math.max(isNaN(requestedIndex) ? 0 : requestedIndex, 0), internalClaims.length - 1);
  const current = internalClaims[currentIndex];

  const internalClaimIds = internalClaims.map((c) => c.id);
  const claimIds = internalClaims.map((c) => c.claim_id);

  const [{ data: claim }, { data: questions }, { data: existingAnswers }, { data: note }, { data: allClaimsBasic }, { data: allAnswers }] =
    await Promise.all([
      supabase.from("self_audit_claims").select("*").eq("id", current.claim_id).single(),
      supabase.from("self_audit_audit_questions").select("*").in("scope", ["claim", "parts"]).order("sort_order"),
      supabase.from("self_audit_internal_audit_answers").select("question_id, answer_value").eq("internal_audit_claim_id", current.id),
      supabase.from("self_audit_internal_audit_notes").select("note_text").eq("internal_audit_claim_id", current.id).maybeSingle(),
      supabase.from("self_audit_claims").select("id, claim_number, work_order_no").in("id", claimIds),
      supabase.from("self_audit_internal_audit_answers").select("internal_audit_claim_id, question_id, answer_value").in("internal_audit_claim_id", internalClaimIds),
    ]);

  const answersMap = new Map((existingAnswers ?? []).map((a) => [a.question_id, a.answer_value]));

  const questionGroups = DEPARTMENT_ORDER.filter((dept) => dept !== "branchops")
    .filter((dept) => (mode === "parts" ? dept === "parts" : dept !== "parts"))
    .map((dept) => ({
      departmentId: dept,
      label: DEPARTMENT_LABELS[dept],
      questions: (questions ?? []).filter((q) => q.department === dept),
    }))
    .filter((g) => g.questions.length > 0);

  // Completeness across the whole audit, for the progress bar, the "jump to
  // next unfinished claim" shortcut, and gating the Branch Operation link.
  const documentQuestionIds = (questions ?? []).filter((q) => q.department && q.department !== "parts").map((q) => q.id);
  const partsQuestionIds = (questions ?? []).filter((q) => q.department === "parts").map((q) => q.id);

  const answeredByClaim = new Map<string, Set<string>>();
  (allAnswers ?? []).forEach((a) => {
    if (a.answer_value == null) return;
    const set = answeredByClaim.get(a.internal_audit_claim_id) ?? new Set<string>();
    set.add(a.question_id);
    answeredByClaim.set(a.internal_audit_claim_id, set);
  });

  const completeness = internalClaims.map((ic) => {
    const answered = answeredByClaim.get(ic.id) ?? new Set<string>();
    const documentsDone = documentQuestionIds.length > 0 && documentQuestionIds.every((id) => answered.has(id));
    const partsDone = partsQuestionIds.length > 0 && partsQuestionIds.every((id) => answered.has(id));
    return { documentsDone, partsDone, fullyDone: documentsDone && partsDone };
  });
  const documentsDoneCount = completeness.filter((c) => c.documentsDone).length;
  const partsDoneCount = completeness.filter((c) => c.partsDone).length;
  const allDone = completeness.every((c) => c.fullyDone);
  const firstUnfinishedInMode = completeness.findIndex((c) => !(mode === "parts" ? c.partsDone : c.documentsDone));

  const claimById = new Map((allClaimsBasic ?? []).map((c) => [c.id, c]));
  const searchItems = internalClaims.map((ic, i) => {
    const c = claimById.get(ic.claim_id);
    return { index: i, workOrderNo: c?.work_order_no ?? null, claimNumber: c?.claim_number ?? "" };
  });

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

      <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-6">
            <div className="space-y-1">
              <p className="text-sm font-medium text-neutral-900">
                Documents: {documentsDoneCount} of {internalClaims.length}
              </p>
              <div className="h-2 w-40 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${internalClaims.length > 0 ? (documentsDoneCount / internalClaims.length) * 100 : 0}%` }}
                />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-neutral-900">
                Parts: {partsDoneCount} of {internalClaims.length}
              </p>
              <div className="h-2 w-40 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${internalClaims.length > 0 ? (partsDoneCount / internalClaims.length) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {firstUnfinishedInMode !== -1 && firstUnfinishedInMode !== currentIndex && (
              <Link
                href={`/admin/internal-audit/${auditId}?claim=${firstUnfinishedInMode}&mode=${mode}`}
                className="text-sm text-brand hover:underline"
              >
                Go to next unfinished claim ({mode}) &rarr;
              </Link>
            )}
            {allDone ? (
              <Link
                href={`/admin/internal-audit/${auditId}/branch-ops`}
                className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark"
              >
                Continue to Branch Operation &rarr;
              </Link>
            ) : (
              <span
                className="cursor-not-allowed rounded-md bg-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-500"
                title="Finish Documents and Parts for every claim first"
              >
                Continue to Branch Operation &rarr;
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-md border border-neutral-300 bg-white p-0.5 text-sm">
          <Link
            href={`/admin/internal-audit/${auditId}?claim=${currentIndex}&mode=documents`}
            className={`rounded px-3 py-1 font-medium ${mode === "documents" ? "bg-brand text-white" : "text-neutral-700 hover:bg-neutral-50"}`}
          >
            Documents
          </Link>
          <Link
            href={`/admin/internal-audit/${auditId}?claim=${currentIndex}&mode=parts`}
            className={`rounded px-3 py-1 font-medium ${mode === "parts" ? "bg-brand text-white" : "text-neutral-700 hover:bg-neutral-50"}`}
          >
            Parts
          </Link>
        </div>
        <WorkOrderSearch auditId={auditId} mode={mode} items={searchItems} />
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-neutral-200 bg-white p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-neutral-500">VIN</dt>
          <dd className="text-neutral-900">{claim?.vin ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Main part name</dt>
          <dd className="text-neutral-900">{claim?.main_part_name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Mileage</dt>
          <dd className="text-neutral-900">{claim?.mileage ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Reception date</dt>
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
        mode={mode}
        questionGroups={questionGroups}
        answers={answersMap}
        noteText={note?.note_text ?? ""}
        locked={false}
      />
    </div>
  );
}
