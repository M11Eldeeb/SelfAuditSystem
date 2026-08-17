import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ReviewForm } from "./review-form";

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
      supabase.from("audit_questions").select("*").order("sort_order"),
      supabase.from("audit_photo_types").select("*").order("sort_order"),
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

  const photoUrls = new Map<string, string>();
  for (const photo of photos ?? []) {
    const { data: signed } = await supabase.storage
      .from("audit-photos")
      .createSignedUrl(photo.storage_path, 300);
    if (signed?.signedUrl) photoUrls.set(photo.photo_type_id, signed.signedUrl);
  }

  const locked = assignment.status === "reviewed";

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/admin/review/${cycleId}/${branchId}`} className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to branch
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-neutral-900">
          Claim {claim?.claim_number ?? assignment.claim_id}
        </h1>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-neutral-200 bg-white p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-neutral-500">VIN</dt>
          <dd className="text-neutral-900">{claim?.vin ?? "—"}</dd>
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
        <div className="flex flex-wrap gap-3">
          {(photoTypes ?? []).map((pt) => (
            <a
              key={pt.id}
              href={photoUrls.get(pt.id)}
              target="_blank"
              rel="noreferrer"
              className={`rounded-md border px-3 py-1.5 text-xs ${
                photoUrls.get(pt.id)
                  ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                  : "border-neutral-200 bg-neutral-50 text-neutral-400"
              }`}
            >
              {pt.label} {photoUrls.get(pt.id) ? "" : "(not uploaded)"}
            </a>
          ))}
        </div>
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
