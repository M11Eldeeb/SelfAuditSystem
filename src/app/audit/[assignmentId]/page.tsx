import { notFound } from "next/navigation";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuditForm } from "./audit-form";
import { ASSIGNMENT_STATUS_LABELS } from "@/lib/status-labels";

export default async function AuditAssignmentPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const user = await requireRole("branch_admin");
  const supabase = await createClient();

  const { data: assignment } = await supabase
    .from("audit_assignments")
    .select("*")
    .eq("id", assignmentId)
    .single();

  if (!assignment || assignment.branch_id !== user.branch_id) {
    notFound();
  }

  const [{ data: claim }, { data: questions }, { data: photoTypes }, { data: answers }, { data: photos }, { data: note }] =
    await Promise.all([
      supabase.from("claims").select("*").eq("id", assignment.claim_id).single(),
      supabase.from("audit_questions").select("*").order("sort_order"),
      supabase.from("audit_photo_types").select("*").order("sort_order"),
      supabase.from("audit_answers").select("*").eq("assignment_id", assignmentId),
      supabase.from("audit_photos").select("*").eq("assignment_id", assignmentId),
      supabase.from("audit_notes").select("*").eq("assignment_id", assignmentId).maybeSingle(),
    ]);

  const answersMap = new Map(
    (answers ?? []).map((a) => [a.question_id, { answer_value: a.answer_value, conditional_value: a.conditional_value }])
  );

  const photoUrls = new Map<string, string>();
  for (const photo of photos ?? []) {
    const { data: signed } = await supabase.storage
      .from("audit-photos")
      .createSignedUrl(photo.storage_path, 300);
    if (signed?.signedUrl) photoUrls.set(photo.photo_type_id, signed.signedUrl);
  }

  const locked = assignment.status !== "not_started" && assignment.status !== "in_progress";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/audit" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to my audits
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-neutral-900">
          Claim {claim?.claim_number ?? assignment.claim_id}
        </h1>
        <p className="text-sm text-neutral-500">{ASSIGNMENT_STATUS_LABELS[assignment.status]}</p>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-neutral-200 bg-white p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-neutral-500">VIN</dt>
          <dd className="text-neutral-900">{claim?.vin ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Model</dt>
          <dd className="text-neutral-900">{claim?.vehicle_model ?? "—"}</dd>
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
        questions={questions ?? []}
        photoTypes={photoTypes ?? []}
        answers={answersMap}
        photoUrls={photoUrls}
        noteText={note?.note_text ?? ""}
        locked={locked}
      />
    </div>
  );
}
