import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ASSIGNMENT_STATUS_LABELS } from "@/lib/status-labels";
import { expireOverdueAssignments } from "@/lib/expire-assignments";

function daysRemaining(deadlineAt: string | null): number | null {
  if (!deadlineAt) return null;
  return Math.ceil((new Date(deadlineAt).getTime() - Date.now()) / 86_400_000);
}

export default async function AuditDashboardPage() {
  const user = await requireRole("branch_admin");
  await expireOverdueAssignments();
  const supabase = await createClient();

  const { data: cycles } = await supabase
    .from("audit_cycles")
    .select("*")
    .order("cycle_month", { ascending: false });

  if (!cycles || cycles.length === 0) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">My Audits</h1>
        <p className="text-sm text-neutral-600">
          No audit cycle has been opened yet. Check back once your warranty officer starts this
          month&apos;s audit.
        </p>
      </div>
    );
  }

  const cycleIds = cycles.map((c) => c.id);
  const cycleMonthById = new Map(cycles.map((c) => [c.id, c.cycle_month]));

  const [{ data: assignments }, { data: results }, { data: opsProgress }] = await Promise.all([
    supabase.from("audit_assignments").select("*").eq("branch_id", user.branch_id!).in("cycle_id", cycleIds),
    supabase
      .from("audit_results")
      .select("*")
      .eq("branch_id", user.branch_id!)
      .order("finalized_at", { ascending: true }),
    supabase
      .from("branch_operation_progress")
      .select("*")
      .eq("branch_id", user.branch_id!)
      .in("cycle_id", cycleIds),
  ]);

  const claimIds = (assignments ?? []).map((a) => a.claim_id);
  const { data: claims } =
    claimIds.length > 0
      ? await supabase.from("claims").select("id, claim_number, work_order_no").in("id", claimIds)
      : { data: [] };
  const claimById = new Map((claims ?? []).map((c) => [c.id, c]));

  const opsProgressByCycle = new Map((opsProgress ?? []).map((p) => [p.cycle_id, p]));

  const assignmentsByCycle = new Map<string, typeof assignments>();
  (assignments ?? []).forEach((a) => {
    const list = assignmentsByCycle.get(a.cycle_id) ?? [];
    list.push(a);
    assignmentsByCycle.set(a.cycle_id, list);
  });

  const cyclesWithWork = cycles.filter((c) => (assignmentsByCycle.get(c.id) ?? []).length > 0);

  if (cyclesWithWork.length === 0) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">My Audits</h1>
        <p className="text-sm text-neutral-600">
          No claims have been assigned to your branch yet for the current cycle.
        </p>
      </div>
    );
  }

  const trend = (results ?? []).slice(-6); // last 6 finalized cycles, oldest to newest
  const latest = trend[trend.length - 1];
  const previous = trend.length > 1 ? trend[trend.length - 2] : null;
  const delta = latest && previous ? Math.round((latest.score_pct - previous.score_pct) * 10) / 10 : null;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold tracking-tight text-neutral-900">My Audits</h1>

      {trend.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-900">Overview</h2>
          <div className="rounded-lg border border-neutral-200 bg-white p-4">
            {delta !== null && (
              <p className="mb-3 text-sm text-neutral-700">
                {delta > 0 && (
                  <span className="font-medium text-emerald-700">
                    Up {delta} point{Math.abs(delta) === 1 ? "" : "s"}
                  </span>
                )}
                {delta < 0 && (
                  <span className="font-medium text-red-700">
                    Down {Math.abs(delta)} point{Math.abs(delta) === 1 ? "" : "s"}
                  </span>
                )}
                {delta === 0 && <span className="font-medium text-neutral-700">Unchanged</span>}{" "}
                vs. the previous audit cycle.
              </p>
            )}
            <div className="flex items-end gap-3">
              {trend.map((r) => (
                <div key={r.id} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-xs font-medium text-neutral-700">{r.score_pct}%</span>
                  <div className="flex h-24 w-full items-end rounded bg-neutral-100">
                    <div
                      className={`w-full rounded ${r.score_pct >= 90 ? "bg-emerald-500" : r.score_pct >= 75 ? "bg-amber-500" : "bg-red-500"}`}
                      style={{ height: `${Math.max(r.score_pct, 4)}%` }}
                    />
                  </div>
                  <span className="text-xs text-neutral-500">
                    {(cycleMonthById.get(r.cycle_id) ?? "").slice(0, 7)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {cyclesWithWork.map((cycle) => {
        const cycleAssignments = assignmentsByCycle.get(cycle.id) ?? [];
        const submittedCount = cycleAssignments.filter((a) => a.status !== "not_started" && a.status !== "in_progress").length;
        const allClaimsDone = cycleAssignments.every((a) => a.status !== "not_started" && a.status !== "in_progress");
        const opsStatus = opsProgressByCycle.get(cycle.id)?.status ?? "not_started";
        const remaining = daysRemaining(cycle.deadline_at);

        return (
          <section key={cycle.id} className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-semibold text-neutral-900">
                {cycle.cycle_month.slice(0, 7)} audit cycle
              </h2>
              <span className="text-xs text-neutral-500">
                {submittedCount} / {cycleAssignments.length} submitted
                {remaining !== null && (
                  <span className={`ml-2 font-medium ${remaining <= 5 ? "text-red-600" : "text-neutral-500"}`}>
                    {remaining > 0
                      ? `· ${remaining} day${remaining === 1 ? "" : "s"} left to submit`
                      : "· Submission deadline passed"}
                  </span>
                )}
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
                  <tr>
                    <th className="px-4 py-2">Claim #</th>
                    <th className="px-4 py-2">Work order #</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {cycleAssignments.map((a) => (
                    <tr key={a.id}>
                      <td className="px-4 py-2 text-neutral-900">
                        {claimById.get(a.claim_id)?.claim_number ?? a.claim_id}
                      </td>
                      <td className="px-4 py-2 text-neutral-600">
                        {claimById.get(a.claim_id)?.work_order_no ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-neutral-600">{ASSIGNMENT_STATUS_LABELS[a.status]}</td>
                      <td className="px-4 py-2 text-right">
                        <Link href={`/audit/${a.id}`} className="text-sm text-brand hover:underline">
                          {a.status === "not_started" || a.status === "in_progress" ? "Continue" : "View"}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {allClaimsDone && (
              <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-neutral-900">Branch Operations</p>
                  <p className="text-xs text-neutral-500">
                    {opsStatus === "not_started"
                      ? "3 questions about branch-wide processes, answered once."
                      : opsStatus === "submitted"
                        ? "Submitted - awaiting officer review."
                        : "Reviewed."}
                  </p>
                </div>
                <Link
                  href={`/audit/branch-ops/${cycle.id}`}
                  className="text-sm text-brand hover:underline"
                >
                  {opsStatus === "not_started" ? "Start" : "View"}
                </Link>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
