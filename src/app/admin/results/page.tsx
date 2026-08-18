import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

function scoreColor(score: number): string {
  if (score >= 90) return "bg-emerald-50 text-emerald-800";
  if (score >= 75) return "bg-amber-50 text-amber-800";
  return "bg-red-50 text-red-800";
}

export default async function ResultsPage() {
  const supabase = await createClient();

  const [{ data: results }, { data: branches }, { data: cycles }] = await Promise.all([
    supabase.from("audit_results").select("*"),
    supabase.from("branches").select("id, name").order("name"),
    supabase.from("audit_cycles").select("id, cycle_month").order("cycle_month", { ascending: true }),
  ]);

  const resultByBranchCycle = new Map((results ?? []).map((r) => [`${r.branch_id}:${r.cycle_id}`, r]));

  const cyclesWithResults = (cycles ?? []).filter((c) =>
    (results ?? []).some((r) => r.cycle_id === c.id)
  );

  if (cyclesWithResults.length === 0) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Results</h1>
        <p className="text-sm text-neutral-600">
          No audit cycles have been finalized yet. Finalize a branch&apos;s review to see results here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Results</h1>
      <p className="text-sm text-neutral-600">
        Compliance score per branch per audit cycle. Click a score to see that branch&apos;s claim-by-claim
        review.
      </p>
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
            {(branches ?? []).map((b) => (
              <tr key={b.id}>
                <td className="sticky left-0 bg-white px-4 py-2 font-medium text-neutral-900">{b.name}</td>
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
    </div>
  );
}
