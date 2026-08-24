import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ReviewForm } from "./review-form";
import { buildPhotoStatusMap } from "@/lib/photo-status";
import { PhotoLinks } from "@/components/photo-links";

export default async function ClaimReviewPage({
  params,
}: {
  params: Promise<{ cycleId: string; branchId: string; assignmentId: string }>;
}) {
  const { cycleId, branchId, assignmentId } = await params;
  const supabase = await createClient();

  const { data: assignment } = await supabase
    .from("audit_assignments")
    .select("*")
    .eq("id", assignmentId)
    .single();

  if (!assignment || assignment.cycle_id !== cycleId || assignment.branch_id !== branchId) {
    notFound();
  }
  if (assignment.status === "not_started" || assignment.status === "in_progress") {
    notFound();
  }

  const [{ data: claim }, { data: questions }, { data: photoTypes }, { data: answers }, { data: photos }, { data: note }, { data: reviews }] =
    await Promise.all([
      supabase.from("claims").select("*").eq("id", assignment.claim_id).single(),
      supabase.from("audit_questions").select("*").eq("scope", "claim").order("sort_order"),
      supabase.from("audit_photo_types").select("*").eq("scope", "claim").order("sort_order"),
      supabase.from("audit_answers").select("*").eq("assignment_id", assignmentId),
      supabase.from("audit_photos").select("*").eq("assignment_id", assignmentId),
      supabase.from("audit_notes").select("*").eq("assignment_id", assignmentId).maybeSingle(),
      supabase.from("ai_reviews").select("*").eq("assignment_id", assignmentId),
    ]);

  const answersMap = new Map(
    (answers ?? []).map((a) => [a.question_id, { answer_value: a.answer_value, conditional_value: a.conditional_value }])
  );
  const reviewsMap = new Map(
    (reviews ?? []).map((r) => [
      r.question_id,
      {
        ai_suggested_value: r.ai_suggested_value,
        ai_reasoning: r.ai_reasoning,
        ai_confidence: r.ai_confidence,
        officer_value: r.officer_value,
      },
    ])
  );

  const photoStatus = await buildPhotoStatusMap(supabase, photos ?? []);

  const locked = assignment.status === "reviewed";

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/admin/review/${cycleId}/${branchId}`} className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to branch
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">
          Claim {claim?.claim_number ?? assignment.claim_id}
        </h1>
      </div>

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
          <dt className="text-xs text-neutral-500">Mileage (claims data)</dt>
          <dd className="text-neutral-900">{claim?.mileage ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Repair end date</dt>
          <dd className="text-neutral-900">{claim?.repair_end_date ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Dealer submit date</dt>
          <dd className="text-neutral-900">{claim?.dealer_submit_date ?? "—"}</dd>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Photos</h2>
        <PhotoLinks photoTypes={photoTypes ?? []} statusByType={photoStatus} />
        {note?.note_text && (
          <p className="mt-3 text-sm text-neutral-600">
            <span className="font-medium text-neutral-800">Branch admin note:</span> {note.note_text}
          </p>
        )}
      </div>

      <ReviewForm
        assignmentId={assignmentId}
        cycleId={cycleId}
        branchId={branchId}
        questions={questions ?? []}
        answers={answersMap}
        reviews={reviewsMap}
        locked={locked}
      />
    </div>
  );
}
