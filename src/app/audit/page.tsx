import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ASSIGNMENT_STATUS_LABELS } from "@/lib/status-labels";
import { expireOverdueAssignments } from "@/lib/expire-assignments";
import { Podium } from "@/components/podium";
import { StandingsList } from "@/components/standings-list";
import { computeCurrentCycleStandings, computeOverallStandings } from "@/lib/standings";
import { daysUntil, deadlineCountdown, isPastDeadline } from "@/lib/cycle";
import { UpcomingInternalAudits, type UpcomingAudit } from "./upcoming-internal-audit";

export default async function AuditDashboardPage() {
  const user = await requireRole("branch_admin");
  await expireOverdueAssignments();
  const supabase = await createClient();

  const [{ data: cycles }, { data: upcomingRows }] = await Promise.all([
    supabase.from("self_audit_audit_cycles").select("*").order("cycle_month", { ascending: false }),
    supabase.rpc("get_upcoming_internal_audits"),
  ]);

  // Internal audits coming to this branch: shown as a card and a once-per-session pop-up.
  const upcomingAudits: UpcomingAudit[] = (upcomingRows ?? []).map((a) => {
    const days = daysUntil(a.audit_date);
    return {
      id: a.id,
      name: a.name ?? "Internal audit",
      dateLabel: a.audit_date
        ? new Date(`${a.audit_date}T00:00:00Z`).toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })
        : null,
      whenLabel: days == null ? null : days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`,
      claimCount: Number(a.claim_count),
    };
  });

  if (!cycles || cycles.length === 0) {
    return (
      <div className="space-y-8">
        <UpcomingInternalAudits audits={upcomingAudits} />
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">My Audits</h1>
          <p className="text-sm text-neutral-600">
            No audit cycle has been opened yet. Check back once your warranty officer starts this
            month&apos;s audit.
          </p>
        </div>
      </div>
    );
  }

  const cycleIds = cycles.map((c) => c.id);
  // The podium follows the newest cycle, open or completed, so it stays up until the next cycle is generated.
  const currentCycleId = cycles[0]?.id ?? null;

  const [
    { data: assignments },
    { data: opsProgress },
    { data: allBranches },
    { data: allResults },
    { data: allInternalAudits },
    { data: allHistoricalInternalAudits },
    { data: allHistoricalSelfAudits },
  ] = await Promise.all([
    supabase.from("self_audit_audit_assignments").select("*").eq("branch_id", user.branch_id!).in("cycle_id", cycleIds),
    supabase
      .from("self_audit_branch_operation_progress")
      .select("*")
      .eq("branch_id", user.branch_id!)
      .in("cycle_id", cycleIds),
    supabase.from("self_audit_branches").select("id, name").eq("active", true).order("name"),
    supabase.from("self_audit_audit_results").select("*"),
    supabase.rpc("get_finalized_internal_audit_scores"),
    supabase.rpc("get_historical_internal_audit_scores"),
    supabase.rpc("get_historical_self_audit_scores"),
  ]);

  const podiumStandings = computeCurrentCycleStandings(allResults ?? [], allBranches ?? [], currentCycleId);
  const overallStandings = computeOverallStandings(allResults ?? [], allBranches ?? [], [
    ...(allInternalAudits ?? []),
    ...(allHistoricalInternalAudits ?? []),
    ...(allHistoricalSelfAudits ?? []),
  ]);

  const claimIds = (assignments ?? []).map((a) => a.claim_id);
  const { data: claims } =
    claimIds.length > 0
      ? await supabase.from("self_audit_claims").select("id, claim_number, work_order_no").in("id", claimIds)
      : { data: [] };
  const claimById = new Map((claims ?? []).map((c) => [c.id, c]));

  const opsProgressByCycle = new Map((opsProgress ?? []).map((p) => [p.cycle_id, p]));

  const assignmentsByCycle = new Map<string, typeof assignments>();
  (assignments ?? []).forEach((a) => {
    const list = assignmentsByCycle.get(a.cycle_id) ?? [];
    list.push(a);
    assignmentsByCycle.set(a.cycle_id, list);
  });

  // A cycle stops showing once it is closed or its submission deadline has passed:
  // nothing can be submitted any more, and its scores live under Results.
  const cyclesWithWork = cycles.filter(
    (c) => c.status === "open" && !isPastDeadline(c.deadline_at) && (assignmentsByCycle.get(c.id) ?? []).length > 0
  );

  const standingsSection = (podiumStandings.length > 0 || overallStandings.length > 0) && (
    <section className="space-y-5">
      {podiumStandings.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-neutral-900">Top performers</h2>
          <p className="text-xs text-neutral-500">Current cycle.</p>
          <Podium entries={podiumStandings} hideScores />
        </div>
      )}
      {overallStandings.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-neutral-900">Branch Standings</h2>
          <p className="text-xs text-neutral-500">
            Every branch&apos;s average across all finalized self-audit cycles and internal audits, including historical results.
          </p>
          <StandingsList entries={overallStandings} hideScores />
        </div>
      )}
    </section>
  );

  if (cyclesWithWork.length === 0) {
    return (
      <div className="space-y-8">
        <UpcomingInternalAudits audits={upcomingAudits} />
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">My Audits</h1>
          <p className="text-sm text-neutral-600">
            You have no self audit to complete right now. A new one appears here when your warranty officer opens the
            next cycle.
          </p>
        </div>
        {standingsSection}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <UpcomingInternalAudits audits={upcomingAudits} />
      <h1 className="text-2xl font-bold tracking-tight text-neutral-900">My Audits</h1>

      {standingsSection}

      {cyclesWithWork.map((cycle) => {
        const cycleAssignments = assignmentsByCycle.get(cycle.id) ?? [];
        const submittedCount = cycleAssignments.filter((a) => a.status !== "not_started" && a.status !== "in_progress").length;
        const allClaimsDone = cycleAssignments.every((a) => a.status !== "not_started" && a.status !== "in_progress");
        const opsStatus = opsProgressByCycle.get(cycle.id)?.status ?? "not_started";
        const countdown = deadlineCountdown(cycle.deadline_at);

        return (
          <section key={cycle.id} className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-semibold text-neutral-900">
                {cycle.cycle_month.slice(0, 7)} audit cycle
              </h2>
              <span className="text-xs text-neutral-500">
                {submittedCount} / {cycleAssignments.length} submitted
                {countdown !== null && (
                  <span className={`ml-2 font-medium ${countdown.days <= 5 ? "text-red-600" : "text-neutral-500"}`}>
                    {!countdown.passed ? `· ${countdown.text} to submit` : "· Submission deadline passed"}
                  </span>
                )}
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border border-neutral-200/70 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-left text-xs font-semibold tracking-wide text-neutral-500 uppercase border-b border-neutral-200">
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

            <div className="flex items-center justify-between rounded-xl border border-neutral-200/70 bg-white shadow-sm px-4 py-3">
              <div>
                <p className="text-sm font-medium text-neutral-900">
                  Branch Operations <span className="font-normal text-neutral-400">(required, in addition to the claims above)</span>
                </p>
                <p className="text-xs text-neutral-500">
                  {!allClaimsDone
                    ? "3 questions about branch-wide processes, answered once - unlocks after every claim above is submitted."
                    : opsStatus === "not_started"
                      ? "3 questions about branch-wide processes, answered once."
                      : opsStatus === "submitted"
                        ? "Submitted - awaiting officer review."
                        : "Reviewed."}
                </p>
              </div>
              {allClaimsDone ? (
                <Link href={`/audit/branch-ops/${cycle.id}`} className="text-sm text-brand hover:underline">
                  {opsStatus === "not_started" ? "Start" : "View"}
                </Link>
              ) : (
                <span className="text-xs text-neutral-400">Locked</span>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
