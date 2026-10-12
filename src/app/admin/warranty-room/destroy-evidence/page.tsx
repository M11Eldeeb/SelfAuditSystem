import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { destroyEvidenceState, getFlaggedClaimCountsByCycleBranch } from "@/lib/warranty-room/destroy-evidence-status";

export default async function DestroyEvidenceCyclesPage() {
  await requireRole("officer");
  const supabase = await createClient();

  const [{ data: cycles }, { data: evidence }, flaggedByCycle, { data: activeBranches }] = await Promise.all([
    supabase.from("self_audit_warranty_room_cycles").select("id, cycle_month").order("cycle_month", { ascending: false }),
    supabase.from("self_audit_destroy_evidence").select("cycle_id, branch_id, status"),
    getFlaggedClaimCountsByCycleBranch(supabase),
    supabase.from("self_audit_branches").select("id").eq("active", true),
  ]);
  // Closed (inactive) branches are left out of every count.
  const activeBranchIds = new Set((activeBranches ?? []).map((b) => b.id));

  const summaryByCycle = (cycles ?? [])
    .map((c) => {
      const statusByBranch = new Map((evidence ?? []).filter((e) => e.cycle_id === c.id).map((e) => [e.branch_id, e.status]));
      const branchIds = new Set(
        [...(flaggedByCycle.get(c.id)?.keys() ?? []), ...statusByBranch.keys()].filter((id) => activeBranchIds.has(id))
      );
      const summary = { not_submitted: 0, awaiting_approval: 0, approved: 0 };
      branchIds.forEach((id) => (summary[destroyEvidenceState(statusByBranch.get(id))] += 1));
      return { cycle: c, branches: branchIds.size, summary };
    })
    .filter((s) => s.branches > 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/warranty-room" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to Warranty Room
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">Destroy evidence</h1>
        <p className="text-sm text-neutral-600">
          One bulk destruction-video submission per branch per warranty room cycle. Open a cycle to see which branches
          have not submitted, which are awaiting your approval, and which are approved.
        </p>
      </div>

      {summaryByCycle.length === 0 && (
        <p className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 text-sm text-neutral-400">
          No branch has claims flagged yet.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {summaryByCycle.map(({ cycle: c, summary }) => (
          <Link
            key={c.id}
            href={`/admin/warranty-room/destroy-evidence/${c.id}`}
            className="flex flex-col gap-1 rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 transition hover:border-brand hover:shadow-md hover:-translate-y-0.5"
          >
            <p className="text-sm font-semibold text-neutral-900">{c.cycle_month.slice(0, 7)}</p>
            <p className="text-xs text-neutral-500">
              {summary.not_submitted} not submitted, {summary.awaiting_approval} awaiting approval, {summary.approved} approved
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
