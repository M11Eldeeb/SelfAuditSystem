import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ReviewForm } from "./review-form";
import { buildPhotoStatusMap } from "@/lib/photo-status";
import { loadMainPartNames } from "@/lib/claim-main-part";
import {
  AuditDocumentsPanel,
  type AuditDoc,
} from "@/components/audit-documents-panel";
import { after } from "next/server";
import { syncSelfAuditDocsToDrive } from "@/lib/self-audit-drive";
import { CopyText } from "@/components/copy-text";

export default async function ClaimReviewPage({
  params,
}: {
  params: Promise<{ cycleId: string; branchId: string; assignmentId: string }>;
}) {
  const { cycleId, branchId, assignmentId } = await params;
  const supabase = await createClient();

  const { data: assignment } = await supabase
    .from("self_audit_audit_assignments")
    .select("*")
    .eq("id", assignmentId)
    .single();

  if (
    !assignment ||
    assignment.cycle_id !== cycleId ||
    assignment.branch_id !== branchId
  ) {
    notFound();
  }
  if (
    assignment.status === "not_started" ||
    assignment.status === "in_progress"
  ) {
    notFound();
  }

  const [
    { data: claim },
    { data: questions },
    { data: photoTypes },
    { data: answers },
    { data: photos },
    { data: note },
    { data: reviews },
  ] = await Promise.all([
    supabase
      .from("self_audit_claims")
      .select("*")
      .eq("id", assignment.claim_id)
      .single(),
    supabase
      .from("self_audit_audit_questions")
      .select("*")
      .eq("scope", "claim")
      .order("sort_order"),
    supabase
      .from("self_audit_audit_photo_types")
      .select("*")
      .eq("scope", "claim")
      .order("sort_order"),
    supabase
      .from("self_audit_audit_answers")
      .select("*")
      .eq("assignment_id", assignmentId),
    supabase
      .from("self_audit_audit_photos")
      .select("*")
      .eq("assignment_id", assignmentId),
    supabase
      .from("self_audit_audit_notes")
      .select("*")
      .eq("assignment_id", assignmentId)
      .maybeSingle(),
    supabase
      .from("self_audit_ai_reviews")
      .select("*")
      .eq("assignment_id", assignmentId),
  ]);

  const answersMap = new Map(
    (answers ?? []).map((a) => [
      a.question_id,
      { answer_value: a.answer_value, conditional_value: a.conditional_value },
    ]),
  );
  const reviewsMap = new Map(
    (reviews ?? []).map((r) => [
      r.question_id,
      {
        ai_suggested_value: r.ai_suggested_value,
        ai_reasoning: r.ai_reasoning,
        ai_confidence: r.ai_confidence,
        officer_value: r.officer_value,
        officer_comment: r.officer_comment,
      },
    ]),
  );

  const photoStatus = await buildPhotoStatusMap(supabase, photos ?? []);
  // Documents still in Supabase (from before) move to Google Drive once the page is sent.
  if ((photos ?? []).some((p) => !p.deleted_at && !p.storage_path.startsWith("drive:")))
    after(() => syncSelfAuditDocsToDrive({ assignmentId }).catch(() => undefined));
  const mainPartName =
    (await loadMainPartNames(supabase, [assignment.claim_id])).get(
      assignment.claim_id,
    ) ??
    claim?.main_part_name ??
    null;

  const locked = assignment.status === "reviewed";
  // The documents in their set order (Job Card front, back, Repair Agreement, Parts Requisition, QC Report, Supporting).
  const docs: AuditDoc[] = (photoTypes ?? []).map((pt) => {
    const st = photoStatus.get(pt.id);
    if (st && "url" in st) {
      const ext = st.path.split(".").pop()?.toLowerCase() ?? "";
      const kind = ["jpg", "jpeg", "png", "gif", "webp"].includes(ext)
        ? "image"
        : ext === "pdf"
          ? "pdf"
          : "other";
      return { id: pt.id, label: pt.label, status: "ok", url: st.url, kind };
    }
    return {
      id: pt.id,
      label: pt.label,
      status: st && "removed" in st ? "removed" : "missing",
    };
  });

  return (
    <div className="relative left-1/2 grid w-[min(88rem,calc(100vw-var(--sidebar-w,0px)-2rem))] -translate-x-1/2 gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-6">
        <div>
          <Link
            href={`/admin/review/${cycleId}/${branchId}`}
            className="text-sm text-neutral-500 hover:text-neutral-800"
          >
            &larr; Back to branch
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">
            Claim{" "}
            <CopyText
              value={claim?.claim_number ?? assignment.claim_id}
              label="claim number"
            />
          </h1>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-neutral-500">VIN</dt>
            <dd className="text-neutral-900">
              <CopyText value={claim?.vin} label="VIN" className="font-mono" />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Work order #</dt>
            <dd className="text-neutral-900">
              <CopyText value={claim?.work_order_no} label="work order" />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Main part</dt>
            <dd className="text-neutral-900">{mainPartName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Mileage (claims data)</dt>
            <dd className="text-neutral-900">{claim?.mileage ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Repair end date</dt>
            <dd className="text-neutral-900">
              {claim?.repair_end_date ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Dealer submit date</dt>
            <dd className="text-neutral-900">
              {claim?.dealer_submit_date ?? "—"}
            </dd>
          </div>
        </div>

        {/* The documents are on the right (AuditDocumentsPanel). */}
        {note?.note_text && (
          <div className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
            <p className="text-sm text-neutral-600">
              <span className="font-medium text-neutral-800">
                Branch admin note:
              </span>{" "}
              {note.note_text}
            </p>
          </div>
        )}

        <ReviewForm
          assignmentId={assignmentId}
          cycleId={cycleId}
          branchId={branchId}
          claim={claim ?? null}
          questions={questions ?? []}
          answers={answersMap}
          reviews={reviewsMap}
          overallComment={assignment.officer_comment}
          locked={locked}
        />
      </div>
      <div className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
        <AuditDocumentsPanel docs={docs} />
      </div>
    </div>
  );
}
