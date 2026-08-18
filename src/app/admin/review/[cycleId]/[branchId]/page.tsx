import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ASSIGNMENT_STATUS_LABELS } from "@/lib/status-labels";
import { FinalizeButton } from "./finalize-button";

export default async function BranchReviewPage({
  params,
}: {
  params: Promise<{ cycleId: string; branchId: string }>;
}) {
  const { cycleId, branchId } = await params;
  const supabase = await createClient();

  const [{ data: cycle }, { data: branch }, { data: assignments }, { data: result }] = await Promise.all([
    supabase.from("audit_cycles").select("*").eq("id", cycleId).single(),
    supabase.from("branches").select("*").eq("id", branchId).single(),
    supabase.from("audit_assignments").select("*").eq("cycle_id", cycleId).eq("branch_id", branchId),
    supabase
      .from("audit_results")
      .select("*")
      .eq("cycle_id", cycleId)
      .eq("branch_id", branchId)
      .maybeSingle(),
  ]);

  if (!cycle || !branch) notFound();

  const claimIds = (assignments ?? []).map((a) => a.claim_id);
  const { data: claims } =
    claimIds.length > 0
      ? await supabase.from("claims").select("id, claim_number").in("id", claimIds)
      : { data: [] };
  const claimNumberById = new Map((claims ?? []).map((c) => [c.id, c.claim_number]));

  const allReviewed = (assignments ?? []).length > 0 && (assignments ?? []).every((a) => a.status === "reviewed");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/review" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to review
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">
          {branch.name} &mdash; {cycle.cycle_month.slice(0, 7)}
        </h1>
      </div>

      {result && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          Finalized: <span className="font-semibold">{result.score_pct}%</span> on{" "}
          {new Date(result.finalized_at).toLocaleDateString()}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2">Claim #</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {(assignments ?? []).map((a) => (
              <tr key={a.id}>
                <td className="px-4 py-2 text-neutral-900">
                  {claimNumberById.get(a.claim_id) ?? a.claim_id}
                </td>
                <td className="px-4 py-2 text-neutral-600">{ASSIGNMENT_STATUS_LABELS[a.status]}</td>
                <td className="px-4 py-2 text-right">
                  {a.status === "not_started" || a.status === "in_progress" ? (
                    <span className="text-xs text-neutral-400">Not submitted yet</span>
                  ) : (
                    <Link
                      href={`/admin/review/${cycleId}/${branchId}/${a.id}`}
                      className="text-sm text-brand hover:underline"
                    >
                      {a.status === "reviewed" ? "View" : "Review"}
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!result && <FinalizeButton cycleId={cycleId} branchId={branchId} disabled={!allReviewed} />}
    </div>
  );
}
