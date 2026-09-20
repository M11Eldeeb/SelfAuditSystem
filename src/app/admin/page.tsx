import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PodiumCongrats } from "@/components/podium-congrats";
import { StandingsList } from "@/components/standings-list";
import { computeCurrentCycleStandings, computeOverallStandings } from "@/lib/standings";

// Standing recipients for the monthly podium congratulations email, on top
// of every branch admin (fetched fresh below - branches/admins change).
const PODIUM_EMAIL_CC = [
  "mustafa.nasr@jiadmotors.com", // warranty head
  "ahmad.hamdani@jiadmotors.com", // fellow warranty officer
  "ahmed.gomaa@jiadmotors.com",
  "ahmed.hablil@jiadmotors.com",
  "saleh.ismail@jiadmotors.com",
  "osman.ahmed@jiadmotors.com",
  "ahmed.nader@jiadmotors.com",
  "adil.almakhlafi@jiadmotors.com",
  "rami.kamli@jiadmotors.com",
];

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    branch?: string | string[];
    from?: string;
    to?: string;
    sort?: string;
  }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const [{ data: results }, { data: branches }, { data: cycles }, { data: branchAdmins }] = await Promise.all([
    supabase.from("self_audit_audit_results").select("*"),
    supabase.from("self_audit_branches").select("id, name").order("name"),
    supabase.from("self_audit_audit_cycles").select("id, cycle_month, status"),
    supabase.from("self_audit_users").select("email").eq("role", "branch_admin"),
  ]);

  if (!results || results.length === 0) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Overview</h1>
        <p className="text-sm text-neutral-600">
          No audit cycles have been finalized yet. Use the tabs above to upload claims, generate
          audit cycles, and review branch submissions.
        </p>
      </div>
    );
  }

  const selectedBranchIds = new Set(
    params.branch ? (Array.isArray(params.branch) ? params.branch : [params.branch]) : []
  );
  const fromMonth = params.from ? `${params.from}-01` : null;
  const toMonth = params.to ? `${params.to}-01` : null;
  const sortAsc = params.sort === "oldest";

  const cycleMonthById = new Map((cycles ?? []).map((c) => [c.id, c.cycle_month]));

  const filteredBranches = (branches ?? []).filter(
    (b) => selectedBranchIds.size === 0 || selectedBranchIds.has(b.id)
  );
  const filteredBranchIds = new Set(filteredBranches.map((b) => b.id));

  const filteredResults = results.filter((r) => {
    if (!filteredBranchIds.has(r.branch_id)) return false;
    const cycleMonth = cycleMonthById.get(r.cycle_id);
    if (!cycleMonth) return false;
    if (fromMonth && cycleMonth < fromMonth) return false;
    if (toMonth && cycleMonth > toMonth) return false;
    return true;
  });

  const cyclesInRange = [...cycleMonthById.entries()]
    .filter(([, month]) => {
      if (fromMonth && month < fromMonth) return false;
      if (toMonth && month > toMonth) return false;
      return true;
    })
    .filter(([id]) => filteredResults.some((r) => r.cycle_id === id))
    .sort((a, b) => (sortAsc ? a[1].localeCompare(b[1]) : b[1].localeCompare(a[1])));

  const resultByBranchCycle = new Map(filteredResults.map((r) => [`${r.branch_id}:${r.cycle_id}`, r]));

  // Podium and standings use the branch selection but are independent of the
  // from/to date range used by the trend-by-cycle table below: the podium is
  // always this cycle only, standings are always all-time.
  const branchScopedResults = results.filter((r) => filteredBranchIds.has(r.branch_id));
  const openCycle = (cycles ?? []).find((c) => c.status === "open") ?? null;
  const podiumStandings = computeCurrentCycleStandings(branchScopedResults, filteredBranches, openCycle?.id ?? null);
  const overallStandings = computeOverallStandings(branchScopedResults, filteredBranches);
  const cycleLabel = openCycle
    ? new Date(`${openCycle.cycle_month}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";
  const podiumEmailTo = (branchAdmins ?? []).map((u) => u.email).filter((e): e is string => !!e);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Overview</h1>
        <p className="text-sm text-neutral-600">Branch performance across finalized audit cycles.</p>
      </div>

      <form method="get" className="space-y-3 rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <label htmlFor="from" className="text-xs font-medium text-neutral-700">
              From
            </label>
            <input
              id="from"
              name="from"
              type="month"
              defaultValue={params.from}
              className="rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="to" className="text-xs font-medium text-neutral-700">
              To
            </label>
            <input
              id="to"
              name="to"
              type="month"
              defaultValue={params.to}
              className="rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="sort" className="text-xs font-medium text-neutral-700">
              Sort cycles
            </label>
            <select
              id="sort"
              name="sort"
              defaultValue={params.sort ?? "newest"}
              className="rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-sm"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-brand shadow-sm shadow-brand/25 hover:shadow-md hover:shadow-brand/30 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark"
          >
            Apply filters
          </button>
          <Link href="/admin" className="text-sm text-neutral-500 hover:text-neutral-800">
            Reset
          </Link>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-neutral-700">Branches (none selected = all)</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {(branches ?? []).map((b) => (
              <label key={b.id} className="flex items-center gap-1.5 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  name="branch"
                  value={b.id}
                  defaultChecked={selectedBranchIds.has(b.id)}
                  className="accent-brand"
                />
                {b.name}
              </label>
            ))}
          </div>
        </div>
      </form>

      {(podiumStandings.length > 0 || overallStandings.length > 0) ? (
        <section className="space-y-6">
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-neutral-900">Top performers</h2>
            <p className="text-sm text-neutral-600">Current cycle.</p>
            {podiumStandings.length > 0 ? (
              <PodiumCongrats
                entries={podiumStandings}
                cycleLabel={cycleLabel}
                toEmails={podiumEmailTo}
                ccEmails={PODIUM_EMAIL_CC}
              />
            ) : (
              <p className="text-sm text-neutral-500">No branch has been finalized for the current cycle yet.</p>
            )}
          </div>
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-neutral-900">Standings</h2>
            <p className="text-sm text-neutral-600">
              Every branch&apos;s average across all finalized cycles, best to worst. Difference shown is vs. the top performer.
            </p>
            <StandingsList entries={overallStandings} />
          </div>
        </section>
      ) : (
        <p className="text-sm text-neutral-500">No finalized results match these filters.</p>
      )}

      {cyclesInRange.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-neutral-900">Trend by cycle</h2>
          <div className="overflow-x-auto rounded-xl border border-neutral-200/70 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-semibold tracking-wide text-neutral-500 uppercase border-b border-neutral-200">
                <tr>
                  <th className="sticky left-0 bg-neutral-50 px-4 py-2">Branch</th>
                  {cyclesInRange.map(([id, month]) => (
                    <th key={id} className="px-4 py-2 text-center">
                      {month.slice(0, 7)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filteredBranches.map((b) => (
                  <tr key={b.id}>
                    <td className="sticky left-0 bg-white px-4 py-2 font-medium text-neutral-900">{b.name}</td>
                    {cyclesInRange.map(([cycleId]) => {
                      const result = resultByBranchCycle.get(`${b.id}:${cycleId}`);
                      return (
                        <td key={cycleId} className="px-4 py-2 text-center">
                          {result ? (
                            <Link
                              href={`/admin/review/${cycleId}/${b.id}`}
                              className="text-neutral-700 hover:text-brand hover:underline"
                            >
                              {result.score_pct}%
                            </Link>
                          ) : (
                            <span className="text-neutral-300">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
