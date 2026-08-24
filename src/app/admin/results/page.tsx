import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function ResultsPage() {
  const supabase = await createClient();

  const [{ data: cycles }, { data: results }] = await Promise.all([
    supabase.from("audit_cycles").select("*").order("cycle_month", { ascending: false }),
    supabase.from("audit_results").select("cycle_id, score_pct"),
  ]);

  const resultsByCycle = new Map<string, number[]>();
  (results ?? []).forEach((r) => {
    const list = resultsByCycle.get(r.cycle_id) ?? [];
    list.push(r.score_pct);
    resultsByCycle.set(r.cycle_id, list);
  });

  const cyclesWithResults = (cycles ?? []).filter((c) => (resultsByCycle.get(c.id)?.length ?? 0) > 0);

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Results</h1>
      <p className="text-sm text-neutral-600">
        Finalized audit cycles, grouped by month. For a branch-vs-branch comparison, see Overview.
      </p>
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2">Cycle</th>
              <th className="px-4 py-2">Branches finalized</th>
              <th className="px-4 py-2">Average score</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {cyclesWithResults.map((c) => {
              const scores = resultsByCycle.get(c.id) ?? [];
              const avg = Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10;
              return (
                <tr key={c.id}>
                  <td className="px-4 py-2 text-neutral-900">{c.cycle_month.slice(0, 7)}</td>
                  <td className="px-4 py-2 text-neutral-600">{scores.length}</td>
                  <td className="px-4 py-2 text-neutral-600">{avg}%</td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/admin/results/${c.id}`} className="text-sm text-brand hover:underline">
                      Open
                    </Link>
                  </td>
                </tr>
              );
            })}
            {cyclesWithResults.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-neutral-400">
                  No audit cycles have been finalized yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
