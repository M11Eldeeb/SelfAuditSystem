import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function CycleReviewPage({
  params,
}: {
  params: Promise<{ cycleId: string }>;
}) {
  const { cycleId } = await params;
  const supabase = await createClient();

  const { data: cycle } = await supabase.from("self_audit_audit_cycles").select("*").eq("id", cycleId).single();
  if (!cycle) notFound();

  const [{ data: branches }, { data: assignments }, { data: results }, { data: opsProgress }] = await Promise.all([
    supabase.from("self_audit_branches").select("id, name").order("name"),
    supabase.from("self_audit_audit_assignments").select("branch_id, status").eq("cycle_id", cycleId),
    supabase.from("self_audit_audit_results").select("branch_id").eq("cycle_id", cycleId),
    supabase.from("self_audit_branch_operation_progress").select("branch_id, status").eq("cycle_id", cycleId),
  ]);

  const finalizedBranchIds = new Set((results ?? []).map((r) => r.branch_id));
  const opsStatusByBranch = new Map((opsProgress ?? []).map((p) => [p.branch_id, p.status]));

  const statsByBranch = new Map<string, { submitted: number; reviewed: number; total: number }>();
  (assignments ?? []).forEach((a) => {
    const stat = statsByBranch.get(a.branch_id) ?? { submitted: 0, reviewed: 0, total: 0 };
    stat.total += 1;
    if (a.status !== "not_started" && a.status !== "in_progress") stat.submitted += 1;
    if (a.status === "reviewed" || a.status === "expired") stat.reviewed += 1;
    statsByBranch.set(a.branch_id, stat);
  });

  const pendingBranches = (branches ?? []).filter(
    (b) => statsByBranch.has(b.id) && !finalizedBranchIds.has(b.id)
  );

  return (
    <div className="space-y-3">
      <div>
        <Link href="/admin/review" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to review
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">
          {cycle.cycle_month.slice(0, 7)} audit cycle
        </h1>
      </div>
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2">Branch</th>
              <th className="px-4 py-2">Submitted</th>
              <th className="px-4 py-2">Reviewed</th>
              <th className="px-4 py-2">Branch ops</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {pendingBranches.map((b) => {
              const stat = statsByBranch.get(b.id)!;
              return (
                <tr key={b.id}>
                  <td className="px-4 py-2 text-neutral-900">{b.name}</td>
                  <td className="px-4 py-2 text-neutral-600">
                    {stat.submitted} / {stat.total}
                  </td>
                  <td className="px-4 py-2 text-neutral-600">
                    {stat.reviewed} / {stat.total}
                  </td>
                  <td className="px-4 py-2 text-neutral-600 capitalize">
                    {(opsStatusByBranch.get(b.id) ?? "not_started").replace("_", " ")}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/admin/review/${cycleId}/${b.id}`} className="text-sm text-brand hover:underline">
                      Open
                    </Link>
                  </td>
                </tr>
              );
            })}
            {pendingBranches.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">
                  Nothing pending review for this cycle.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
