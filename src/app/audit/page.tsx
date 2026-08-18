import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ASSIGNMENT_STATUS_LABELS } from "@/lib/status-labels";

export default async function AuditDashboardPage() {
  const user = await requireRole("branch_admin");
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

  const [{ data: assignments }, { data: results }] = await Promise.all([
    supabase.from("audit_assignments").select("*").eq("branch_id", user.branch_id!).in("cycle_id", cycleIds),
    supabase
      .from("audit_results")
      .select("*")
      .eq("branch_id", user.branch_id!)
      .order("finalized_at", { ascending: false }),
  ]);

  const claimIds = (assignments ?? []).map((a) => a.claim_id);
  const { data: claims } =
    claimIds.length > 0
      ? await supabase.from("claims").select("id, claim_number, work_order_no").in("id", claimIds)
      : { data: [] };
  const claimById = new Map((claims ?? []).map((c) => [c.id, c]));

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

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold tracking-tight text-neutral-900">My Audits</h1>

      {results && results.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-900">Past results</h2>
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
                <tr>
                  <th className="px-4 py-2">Cycle</th>
                  <th className="px-4 py-2">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {results.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 text-neutral-900">
                      {(cycleMonthById.get(r.cycle_id) ?? "").slice(0, 7)}
                    </td>
                    <td className="px-4 py-2 font-medium text-neutral-900">{r.score_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {cyclesWithWork.map((cycle) => {
        const cycleAssignments = assignmentsByCycle.get(cycle.id) ?? [];
        const submittedCount = cycleAssignments.filter((a) => a.status !== "not_started" && a.status !== "in_progress").length;

        return (
          <section key={cycle.id} className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-semibold text-neutral-900">
                {cycle.cycle_month.slice(0, 7)} audit cycle
              </h2>
              <span className="text-xs text-neutral-500">
                {submittedCount} / {cycleAssignments.length} submitted
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
          </section>
        );
      })}
    </div>
  );
}
