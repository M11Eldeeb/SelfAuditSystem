import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { expireOverdueAssignments } from "@/lib/expire-assignments";

export default async function ReviewIndexPage() {
  await expireOverdueAssignments();
  const supabase = await createClient();

  const [{ data: cycles }, { data: assignments }, { data: results }] = await Promise.all([
    supabase.from("self_audit_audit_cycles").select("*").order("cycle_month", { ascending: false }),
    supabase.from("self_audit_audit_assignments").select("cycle_id, branch_id, status"),
    supabase.from("self_audit_audit_results").select("cycle_id, branch_id"),
  ]);

  const finalizedKeys = new Set((results ?? []).map((r) => `${r.cycle_id}:${r.branch_id}`));

  const branchesByCycle = new Map<string, Set<string>>();
  const statsByCycle = new Map<string, { submitted: number; total: number }>();
  (assignments ?? []).forEach((a) => {
    const key = `${a.cycle_id}:${a.branch_id}`;
    if (finalizedKeys.has(key)) return; // this branch is done - lives in Results now

    const branchSet = branchesByCycle.get(a.cycle_id) ?? new Set<string>();
    branchSet.add(a.branch_id);
    branchesByCycle.set(a.cycle_id, branchSet);

    const stat = statsByCycle.get(a.cycle_id) ?? { submitted: 0, total: 0 };
    stat.total += 1;
    if (a.status !== "not_started" && a.status !== "in_progress") stat.submitted += 1;
    statsByCycle.set(a.cycle_id, stat);
  });

  const pendingCycles = (cycles ?? []).filter((c) => (branchesByCycle.get(c.id)?.size ?? 0) > 0);

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Review</h1>
      <p className="text-sm text-neutral-600">
        Audit cycles with branches still needing review. A branch drops off this list once it&apos;s
        finalized - find it under Results after that.
      </p>
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2">Cycle</th>
              <th className="px-4 py-2">Branches pending</th>
              <th className="px-4 py-2">Submitted</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {pendingCycles.map((c) => {
              const stat = statsByCycle.get(c.id) ?? { submitted: 0, total: 0 };
              return (
                <tr key={c.id}>
                  <td className="px-4 py-2 text-neutral-900">{c.cycle_month.slice(0, 7)}</td>
                  <td className="px-4 py-2 text-neutral-600">{branchesByCycle.get(c.id)?.size ?? 0}</td>
                  <td className="px-4 py-2 text-neutral-600">
                    {stat.submitted} / {stat.total}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/admin/review/${c.id}`} className="text-sm text-brand hover:underline">
                      Open
                    </Link>
                  </td>
                </tr>
              );
            })}
            {pendingCycles.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-neutral-400">
                  Nothing pending review.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
