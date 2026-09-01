import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { scoreBadgeClasses } from "@/lib/score-color";

export default async function CycleResultsPage({
  params,
}: {
  params: Promise<{ cycleId: string }>;
}) {
  const { cycleId } = await params;
  const supabase = await createClient();

  const { data: cycle } = await supabase.from("self_audit_audit_cycles").select("*").eq("id", cycleId).single();
  if (!cycle) notFound();

  const { data: results } = await supabase
    .from("self_audit_audit_results")
    .select("*")
    .eq("cycle_id", cycleId)
    .order("score_pct", { ascending: false });

  const branchIds = (results ?? []).map((r) => r.branch_id);
  const { data: branches } =
    branchIds.length > 0
      ? await supabase.from("self_audit_branches").select("id, name").in("id", branchIds)
      : { data: [] };
  const branchNameById = new Map((branches ?? []).map((b) => [b.id, b.name]));

  return (
    <div className="space-y-3">
      <div>
        <Link href="/admin/results" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to results
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">
          {cycle.cycle_month.slice(0, 7)} results
        </h1>
      </div>
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2">Branch</th>
              <th className="px-4 py-2">Score</th>
              <th className="px-4 py-2">Finalized</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {(results ?? []).map((r) => (
              <tr key={r.branch_id}>
                <td className="px-4 py-2 text-neutral-900">{branchNameById.get(r.branch_id) ?? "—"}</td>
                <td className="px-4 py-2">
                  <span className={`inline-block rounded px-2 py-1 font-medium ${scoreBadgeClasses(r.score_pct)}`}>
                    {r.score_pct}%
                  </span>
                </td>
                <td className="px-4 py-2 text-neutral-600">
                  {new Date(r.finalized_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link
                    href={`/admin/review/${cycleId}/${r.branch_id}`}
                    className="text-sm text-brand hover:underline"
                  >
                    View detail
                  </Link>
                </td>
              </tr>
            ))}
            {(results ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-neutral-400">
                  No branches finalized for this cycle yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
