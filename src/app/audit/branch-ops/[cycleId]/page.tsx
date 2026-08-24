import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BranchOpsForm } from "./branch-ops-form";
import { buildPhotoStatusMap } from "@/lib/photo-status";

const STATUS_LABELS: Record<string, string> = {
  not_started: "Not started",
  submitted: "Submitted - awaiting officer review",
  reviewed: "Reviewed",
};

export default async function BranchOpsPage({
  params,
}: {
  params: Promise<{ cycleId: string }>;
}) {
  const { cycleId } = await params;
  const user = await requireRole("branch_admin");
  const supabase = await createClient();
  const branchId = user.branch_id!;

  const { data: assignments } = await supabase
    .from("audit_assignments")
    .select("status")
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId);

  if (!assignments || assignments.length === 0) notFound();

  const allClaimsDone = assignments.every((a) => a.status !== "not_started" && a.status !== "in_progress");

  const [{ data: questions }, { data: photoTypes }, { data: progress }, { data: existingAnswers }, { data: existingPhotos }, { data: cycle }] =
    await Promise.all([
      supabase.from("audit_questions").select("*").eq("scope", "branch").order("sort_order"),
      supabase.from("audit_photo_types").select("*").eq("scope", "branch").order("sort_order"),
      supabase
        .from("branch_operation_progress")
        .select("*")
        .eq("cycle_id", cycleId)
        .eq("branch_id", branchId)
        .maybeSingle(),
      supabase.from("branch_operation_answers").select("*").eq("cycle_id", cycleId).eq("branch_id", branchId),
      supabase.from("branch_operation_photos").select("*").eq("cycle_id", cycleId).eq("branch_id", branchId),
      supabase.from("audit_cycles").select("cycle_month").eq("id", cycleId).single(),
    ]);

  const answersMap = new Map((existingAnswers ?? []).map((a) => [a.question_id, a.answer_value]));
  const photoStatus = await buildPhotoStatusMap(supabase, existingPhotos ?? []);
  const status = progress?.status ?? "not_started";
  const locked = !allClaimsDone || status !== "not_started";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/audit" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to my audits
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">
          Branch Operations - {cycle?.cycle_month.slice(0, 7)}
        </h1>
        <p className="text-sm text-neutral-500">
          Answered once for the branch, not tied to a specific claim. {STATUS_LABELS[status]}
        </p>
      </div>

      {!allClaimsDone && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Finish all 10 assigned claims first - this unlocks once every claim has been submitted.
        </p>
      )}

      <BranchOpsForm
        cycleId={cycleId}
        questions={questions ?? []}
        answers={answersMap}
        photoTypes={photoTypes ?? []}
        photoStatus={photoStatus}
        locked={locked}
      />
    </div>
  );
}
