import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

function scoreColor(score: number): string {
  if (score >= 90) return "bg-emerald-50 text-emerald-800";
  if (score >= 75) return "bg-amber-50 text-amber-800";
  return "bg-red-50 text-red-800";
}

function scoreBarColor(score: number): string {
  if (score >= 90) return "bg-emerald-500";
  if (score >= 75) return "bg-amber-500";
  return "bg-red-500";
}

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string | string[]; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const [{ data: results }, { data: branches }, { data: cycles }] = await Promise.all([
    supabase.from("audit_results").select("*"),
    supabase.from("branches").select("id, name").order("name"),
    supabase.from("audit_cycles").select("id, cycle_month").order("cycle_month", { ascending: true }),
  ]);

  if (!results || results.length === 0) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Results</h1>
        <p className="text-sm text-neutral-600">
          No audit cycles have been finalized yet. Finalize a branch&apos;s review to see results here.
        </p>
      </div>
    );
  }

  const selectedBranchIds = new Set(
    params.branch ? (Array.isArray(params.branch) ? params.branch : [params.branch]) : []
  );
  const fromMonth = params.from ? `${params.from}-01` : null;
  const toMonth = params.to ? `${params.to}-01` : null;

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

  const cyclesInRange = (cycles ?? []).filter((c) => {
    if (fromMonth && c.cycle_month < fromMonth) return false;
    if (toMonth && c.cycle_month > toMonth) return false;
    return true;
  });
  const cyclesWithResults = cyclesInRange.filter((c) => filteredResults.some((r) => r.cycle_id === c.id));

  const resultByBranchCycle = new Map(filteredResults.map((r) => [`${r.branch_id}:${r.cycle_id}`, r]));

  const avgByBranch = new Map<string, { name: string; avg: number; count: number }>();
  for (const branch of filteredBranches) {
    const branchResults = filteredResults.filter((r) => r.branch_id === branch.id);
    if (branchResults.length === 0) continue;
    const avg = branchResults.reduce((sum, r) => sum + r.score_pct, 0) / branchResults.length;
    avgByBranch.set(branch.id, { name: branch.name, avg: Math.round(avg * 10) / 10, count: branchResults.length });
  }
  const ranked = [...avgByBranch.entries()].sort((a, b) => b[1].avg - a[1].avg);

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Results</h1>
        <p className="text-sm text-neutral-600">
          Compliance score per branch per audit cycle. Click a score to see that branch&apos;s
          claim-by-claim review.
        </p>
      </div>

      <form method="get" className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
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
          <button
            type="submit"
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark"
          >
            Apply filters
          </button>
          <Link href="/admin/results" className="text-sm text-neutral-500 hover:text-neutral-800">
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

      {ranked.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-neutral-900">Branch comparison</h2>
          <p className="text-sm text-neutral-600">
            Average score across {ranked.length === 1 ? "the filtered cycle(s)" : "the filtered branches and cycles"}.
          </p>
          <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4">
            {ranked.map(([branchId, b], i) => (
              <div key={branchId} className="flex items-center gap-3">
                <span className="w-6 text-right text-xs text-neutral-400">{i + 1}</span>
                <span className="w-40 shrink-0 truncate text-sm text-neutral-900">{b.name}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-neutral-100">
                  <div
                    className={`h-full rounded-full ${scoreBarColor(b.avg)}`}
                    style={{ width: `${Math.min(b.avg, 100)}%` }}
                  />
                </div>
                <span className="w-16 text-right text-sm font-medium text-neutral-900">{b.avg}%</span>
                {i === 0 && ranked.length > 1 && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    Highest
                  </span>
                )}
                {i === ranked.length - 1 && ranked.length > 1 && (
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                    Lowest
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {cyclesWithResults.length === 0 ? (
        <p className="text-sm text-neutral-500">No finalized results match these filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
              <tr>
                <th className="sticky left-0 bg-neutral-50 px-4 py-2">Branch</th>
                {cyclesWithResults.map((c) => (
                  <th key={c.id} className="px-4 py-2 text-center">
                    {c.cycle_month.slice(0, 7)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filteredBranches.map((b) => (
                <tr key={b.id}>
                  <td className="sticky left-0 bg-white px-4 py-2 font-medium text-neutral-900">
                    {b.name}
                  </td>
                  {cyclesWithResults.map((c) => {
                    const result = resultByBranchCycle.get(`${b.id}:${c.id}`);
                    return (
                      <td key={c.id} className="px-4 py-2 text-center">
                        {result ? (
                          <Link
                            href={`/admin/review/${c.id}/${b.id}`}
                            className={`inline-block rounded px-2 py-1 font-medium hover:opacity-80 ${scoreColor(result.score_pct)}`}
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
      )}
    </div>
  );
}
