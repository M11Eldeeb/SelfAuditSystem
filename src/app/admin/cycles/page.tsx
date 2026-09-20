import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CycleForm } from "./cycle-form";
import { DeleteCycleButton } from "./delete-cycle-button";
import { expireOverdueAssignments } from "@/lib/expire-assignments";

function daysRemaining(deadlineAt: string | null): number {
  if (!deadlineAt) return 0;
  return Math.max(0, Math.ceil((new Date(deadlineAt).getTime() - Date.now()) / 86_400_000));
}

export default async function CyclesPage() {
  await expireOverdueAssignments();
  const supabase = await createClient();

  const [{ data: cycles }, { data: assignments }, { data: results }, { data: branchAdmins }] = await Promise.all([
    supabase.from("self_audit_audit_cycles").select("*").order("cycle_month", { ascending: false }),
    supabase.from("self_audit_audit_assignments").select("cycle_id, branch_id, status"),
    supabase.from("self_audit_audit_results").select("cycle_id, branch_id"),
    supabase.from("self_audit_users").select("branch_id, email").eq("role", "branch_admin"),
  ]);

  // Reminder mailto link for the open cycle: BCCs every branch admin whose
  // branch still has an unsubmitted assignment in it. Deliberately a plain
  // mailto link, not a send-it-for-you button - opens the officer's own mail
  // client with the message ready so they review before it goes out, no
  // email-provider account/API key needed.
  const openCycle = (cycles ?? []).find((c) => c.status === "open");
  let reminderHref: string | null = null;
  let reminderRecipientCount = 0;
  if (openCycle) {
    const emailsByBranch = new Map<string, string[]>();
    (branchAdmins ?? []).forEach((u) => {
      if (!u.branch_id || !u.email) return;
      const list = emailsByBranch.get(u.branch_id) ?? [];
      list.push(u.email);
      emailsByBranch.set(u.branch_id, list);
    });

    const unfinishedBranchIds = new Set(
      (assignments ?? [])
        .filter((a) => a.cycle_id === openCycle.id && (a.status === "not_started" || a.status === "in_progress"))
        .map((a) => a.branch_id)
    );

    const recipients = [...unfinishedBranchIds].flatMap((branchId) => emailsByBranch.get(branchId) ?? []);
    const uniqueRecipients = [...new Set(recipients)];
    reminderRecipientCount = uniqueRecipients.length;

    if (uniqueRecipients.length > 0) {
      const remaining = daysRemaining(openCycle.deadline_at);
      const cycleLabel = openCycle.cycle_month.slice(0, 7);
      const subject = `Reminder: ${cycleLabel} self-audit due in ${remaining} day${remaining === 1 ? "" : "s"}`;
      const body = [
        `This is a reminder that the ${cycleLabel} self-audit cycle closes in ${remaining} day${remaining === 1 ? "" : "s"}.`,
        "",
        "Please complete and submit your branch's assigned claims as soon as possible to avoid missing the deadline.",
        "",
        "Thank you.",
      ].join("\n");
      reminderHref = `mailto:?bcc=${encodeURIComponent(uniqueRecipients.join(","))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    }
  }

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
        <div className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
          <CycleForm />
        </div>
      </section>

      {openCycle && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-neutral-900">Reminder</h2>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
            <div>
              <p className="text-sm font-medium text-neutral-900">
                {openCycle.cycle_month.slice(0, 7)} self-audit
              </p>
              <p className="text-xs text-neutral-500">
                {reminderRecipientCount > 0
                  ? `${reminderRecipientCount} branch admin(s) still have unfinished claims in this cycle.`
                  : "Every branch has finished this cycle - nothing to remind."}
              </p>
            </div>
            {reminderHref && (
              <a
                href={reminderHref}
                className="rounded-lg bg-brand shadow-sm shadow-brand/25 hover:shadow-md hover:shadow-brand/30 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark"
              >
                Send reminder email
              </a>
            )}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Cycles</h2>
        <div className="overflow-hidden rounded-xl border border-neutral-200/70 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-semibold tracking-wide text-neutral-500 uppercase border-b border-neutral-200">
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
        <div className="overflow-hidden rounded-xl border border-neutral-200/70 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-semibold tracking-wide text-neutral-500 uppercase border-b border-neutral-200">
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
