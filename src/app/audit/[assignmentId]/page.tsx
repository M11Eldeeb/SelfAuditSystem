import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuditForm } from "./audit-form";
import { ASSIGNMENT_STATUS_LABELS } from "@/lib/status-labels";
import { buildPhotoStatusMap } from "@/lib/photo-status";
import { expireOverdueAssignments } from "@/lib/expire-assignments";

export default async function AuditAssignmentPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const user = await requireRole("branch_admin");
  await expireOverdueAssignments();
  const supabase = await createClient();

  const { data: assignment } = await supabase
    .from("self_audit_audit_assignments")
    .select("*")
    .eq("id", assignmentId)
    .single();

  if (!assignment || assignment.branch_id !== user.branch_id) {
    notFound();
  }

  const [{ data: claim }, { data: questions }, { data: photoTypes }, { data: answers }, { data: photos }, { data: note }] =
    await Promise.all([
      supabase.from("self_audit_claims").select("*").eq("id", assignment.claim_id).single(),
      supabase.from("self_audit_audit_questions").select("*").eq("scope", "claim").order("sort_order"),
      supabase.from("self_audit_audit_photo_types").select("*").eq("scope", "claim").order("sort_order"),
      supabase.from("self_audit_audit_answers").select("*").eq("assignment_id", assignmentId),
      supabase.from("self_audit_audit_photos").select("*").eq("assignment_id", assignmentId),
      supabase.from("self_audit_audit_notes").select("*").eq("assignment_id", assignmentId).maybeSingle(),
    ]);

  const answersMap = new Map(
    (answers ?? []).map((a) => [a.question_id, { answer_value: a.answer_value, conditional_value: a.conditional_value }])
  );

  const photoStatus = await buildPhotoStatusMap(supabase, photos ?? []);

  const locked = assignment.status !== "not_started" && assignment.status !== "in_progress";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/audit" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to my audits
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">
          Claim {claim?.claim_number ?? assignment.claim_id}
          {claim?.work_order_no && (
            <span className="ml-2 text-lg font-medium text-neutral-500">
              &middot; WO {claim.work_order_no}
            </span>
          )}
        </h1>
        <p className="text-sm text-neutral-500">{ASSIGNMENT_STATUS_LABELS[assignment.status]}</p>
      </div>

      {assignment.status === "expired" && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">30 day countdown ended</p>
          <p className="mt-1">
            This claim wasn&apos;t submitted before the audit cycle&apos;s 30-day deadline, so it&apos;s
            automatically scored 0% and can no longer be answered.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-neutral-200 bg-white p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-neutral-500">VIN</dt>
          <dd className="text-neutral-900">{claim?.vin ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Work order #</dt>
          <dd className="text-neutral-900">{claim?.work_order_no ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Mileage</dt>
          <dd className="text-neutral-900">{claim?.mileage ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Creation date</dt>
          <dd className="text-neutral-900">{claim?.creation_date ?? "—"}</dd>
        </div>
      </div>

      <AuditForm
        assignmentId={assignmentId}
        claim={claim ?? null}
        questions={questions ?? []}
        photoTypes={photoTypes ?? []}
        answers={answersMap}
        photoStatus={photoStatus}
        noteText={note?.note_text ?? ""}
        locked={locked}
      />
    </div>
  );
}
