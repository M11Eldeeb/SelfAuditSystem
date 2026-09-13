import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CycleForm } from "./cycle-form";
import { DeleteCycleButton } from "./delete-cycle-button";
import { expireOverdueAssignments } from "@/lib/expire-assignments";

export default async function CyclesPage() {
  await expireOverdueAssignments();
  const supabase = await createClient();

  const [{ data: cycles }, { data: assignments }, { data: results }] = await Promise.all([
    supabase.from("self_audit_audit_cycles").select("*").order("cycle_month", { ascending: false }),
    supabase.from("self_audit_audit_assignments").select("cycle_id, branch_id, status"),
    supabase.from("self_audit_audit_results").select("cycle_id, branch_id"),
  ]);

  const statsByCycle = new Map<string, { total: number; submitted: number; reviewed: number }>();
  (assignments ?? []).forEach((a) => {
    const stat = statsByCycle.get(a.cycle_id) ?? { total: 0, submitted: 0, reviewed: 0 };
    stat.total += 1;
    if (a.status === "submitted" || a.status === "ai_checked" || a.status === "reviewed") {
      stat.submitted += 1;
    }
    if (a.status === "reviewed") stat.reviewed += 1;
    statsByCycle.set(a.cycle_id, stat);
  });

  // Review section: same "still needs review" logic /admin/review used to
  // show on its own page - a branch drops off once it's finalized (it lives
  // under Results after that).
  const finalizedKeys = new Set((results ?? []).map((r) => `${r.cycle_id}:${r.branch_id}`));
  const branchesPendingByCycle = new Map<string, Set<string>>();
  const reviewStatsByCycle = new Map<string, { submitted: number; total: number }>();
  (assignments ?? []).forEach((a) => {
    const key = `${a.cycle_id}:${a.branch_id}`;
    if (finalizedKeys.has(key)) return;

    const branchSet = branchesPendingByCycle.get(a.cycle_id) ?? new Set<string>();
    branchSet.add(a.branch_id);
    branchesPendingByCycle.set(a.cycle_id, branchSet);

    const stat = reviewStatsByCycle.get(a.cycle_id) ?? { submitted: 0, total: 0 };
    stat.total += 1;
    if (a.status !== "not_started" && a.status !== "in_progress") stat.submitted += 1;
    reviewStatsByCycle.set(a.cycle_id, stat);
  });
  const pendingReviewCycles = (cycles ?? []).filter((c) => (branchesPendingByCycle.get(c.id)?.size ?? 0) > 0);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Generate audit cycle</h1>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <CycleForm />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Cycles</h2>
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-2">Cycle month</th>
                <th className="px-4 py-2">Claims month</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Assignments</th>
                <th className="px-4 py-2">Submitted</th>
                <th className="px-4 py-2">Reviewed</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {(cycles ?? []).map((c) => {
                const stat = statsByCycle.get(c.id) ?? { total: 0, submitted: 0, reviewed: 0 };
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-2 text-neutral-900">{c.cycle_month.slice(0, 7)}</td>
                    <td className="px-4 py-2 text-neutral-600">{c.claims_month.slice(0, 7)}</td>
                    <td className="px-4 py-2 text-neutral-600 capitalize">{c.status}</td>
                    <td className="px-4 py-2 text-neutral-600">{stat.total}</td>
                    <td className="px-4 py-2 text-neutral-600">{stat.submitted}</td>
                    <td className="px-4 py-2 text-neutral-600">{stat.reviewed}</td>
                    <td className="px-4 py-2 text-right">
                      <DeleteCycleButton
                        cycleId={c.id}
                        cycleMonth={c.cycle_month.slice(0, 7)}
                        hasStartedWork={stat.submitted > 0}
                      />
                    </td>
                  </tr>
                );
              })}
              {(cycles ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-neutral-400">
                    No audit cycles yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Review</h2>
        <p className="text-sm text-neutral-600">
          Cycles with branches still needing review. A branch drops off this list once it&apos;s
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
              {pendingReviewCycles.map((c) => {
                const stat = reviewStatsByCycle.get(c.id) ?? { submitted: 0, total: 0 };
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-2 text-neutral-900">{c.cycle_month.slice(0, 7)}</td>
                    <td className="px-4 py-2 text-neutral-600">{branchesPendingByCycle.get(c.id)?.size ?? 0}</td>
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
              {pendingReviewCycles.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-neutral-400">
                    Nothing pending review.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
