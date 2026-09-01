import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BranchOpsReviewForm } from "./branch-ops-review-form";
import { buildPhotoStatusMap } from "@/lib/photo-status";
import { PhotoLinks } from "@/components/photo-links";

export default async function BranchOpsReviewPage({
  params,
}: {
  params: Promise<{ cycleId: string; branchId: string }>;
}) {
  const { cycleId, branchId } = await params;
  const supabase = await createClient();

  const [{ data: branch }, { data: cycle }, { data: progress }] = await Promise.all([
    supabase.from("self_audit_branches").select("*").eq("id", branchId).single(),
    supabase.from("self_audit_audit_cycles").select("*").eq("id", cycleId).single(),
    supabase
      .from("self_audit_branch_operation_progress")
      .select("*")
      .eq("cycle_id", cycleId)
      .eq("branch_id", branchId)
      .maybeSingle(),
  ]);

  if (!branch || !cycle) notFound();
  if (!progress || progress.status === "not_started") notFound();

  const [{ data: questions }, { data: answers }, { data: photoTypes }, { data: photos }] = await Promise.all([
    supabase.from("self_audit_audit_questions").select("*").eq("scope", "branch").order("sort_order"),
    supabase.from("self_audit_branch_operation_answers").select("*").eq("cycle_id", cycleId).eq("branch_id", branchId),
    supabase.from("self_audit_audit_photo_types").select("*").eq("scope", "branch").order("sort_order"),
    supabase.from("self_audit_branch_operation_photos").select("*").eq("cycle_id", cycleId).eq("branch_id", branchId),
  ]);

  const answersMap = new Map(
    (answers ?? []).map((a) => [a.question_id, { answer_value: a.answer_value, officer_value: a.officer_value }])
  );
  const photoStatus = await buildPhotoStatusMap(supabase, photos ?? []);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/admin/review/${cycleId}/${branchId}`} className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to branch
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">
          {branch.name} Branch Operations &mdash; {cycle.cycle_month.slice(0, 7)}
        </h1>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Photos</h2>
        <PhotoLinks photoTypes={photoTypes ?? []} statusByType={photoStatus} />
      </div>

      <BranchOpsReviewForm
        cycleId={cycleId}
        branchId={branchId}
        questions={questions ?? []}
        answers={answersMap}
        locked={progress.status === "reviewed"}
      />
    </div>
  );
}
