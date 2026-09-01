import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Podium } from "@/components/podium";
import { StandingsList } from "@/components/standings-list";
import {
  computeStandings,
  parseStandingsPeriod,
  STANDINGS_PERIODS,
  STANDINGS_PERIOD_LABELS,
} from "@/lib/standings";

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    branch?: string | string[];
    from?: string;
    to?: string;
    sort?: string;
    period?: string;
  }>;
}) {
  const params = await searchParams;
  const period = parseStandingsPeriod(params.period);
  const supabase = await createClient();

  const [{ data: results }, { data: branches }, { data: cycles }] = await Promise.all([
    supabase.from("self_audit_audit_results").select("*"),
    supabase.from("self_audit_branches").select("id, name").order("name"),
    supabase.from("self_audit_audit_cycles").select("id, cycle_month"),
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

  // Standings/podium use the branch selection but always rank by each branch's
  // most recent N cycles, independent of the from/to date range used by the
  // trend-by-cycle table below.
  const branchScopedResults = results.filter((r) => filteredBranchIds.has(r.branch_id));
  const standings = computeStandings(branchScopedResults, filteredBranches, cycleMonthById, period);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Overview</h1>
        <p className="text-sm text-neutral-600">Branch performance across finalized audit cycles.</p>
      </div>

      <form method="get" className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <label htmlFor="period" className="text-xs font-medium text-neutral-700">
              Standings period
            </label>
            <select
              id="period"
              name="period"
              defaultValue={period}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            >
              {STANDINGS_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {STANDINGS_PERIOD_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="from" className="text-xs font-medium text-neutral-700">
              From
            </label>
            <input
              id="from"
              name="from"
              type="month"
              defaultValue={params.from}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
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
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
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
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>
          <button
            type="submit"
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark"
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

      {standings.length > 0 ? (
        <section className="space-y-6">
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-neutral-900">Top performers</h2>
            <p className="text-sm text-neutral-600">{STANDINGS_PERIOD_LABELS[period]}.</p>
            <Podium entries={standings} />
          </div>
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-neutral-900">Standings</h2>
            <p className="text-sm text-neutral-600">
              Every branch, best to worst. Difference shown is vs. the top performer.
            </p>
            <StandingsList entries={standings} />
          </div>
        </section>
      ) : (
        <p className="text-sm text-neutral-500">No finalized results match these filters.</p>
      )}

      {cyclesInRange.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-neutral-900">Trend by cycle</h2>
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
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
