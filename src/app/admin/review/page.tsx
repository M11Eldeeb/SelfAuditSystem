import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function ReviewIndexPage() {
  const supabase = await createClient();

  const [{ data: cycles }, { data: branches }, { data: assignments }] = await Promise.all([
    supabase.from("audit_cycles").select("*").order("cycle_month", { ascending: false }),
    supabase.from("branches").select("id, name"),
    supabase.from("audit_assignments").select("cycle_id, branch_id, status"),
  ]);

  const cycleById = new Map((cycles ?? []).map((c) => [c.id, c]));
  const branchNameById = new Map((branches ?? []).map((b) => [b.id, b.name]));

  const groups = new Map<
    string,
    { cycleId: string; branchId: string; total: number; submitted: number; reviewed: number }
  >();
  (assignments ?? []).forEach((a) => {
    const key = `${a.cycle_id}:${a.branch_id}`;
    const g = groups.get(key) ?? { cycleId: a.cycle_id, branchId: a.branch_id, total: 0, submitted: 0, reviewed: 0 };
    g.total += 1;
    if (a.status !== "not_started" && a.status !== "in_progress") g.submitted += 1;
    if (a.status === "reviewed") g.reviewed += 1;
    groups.set(key, g);
  });

  const rows = Array.from(groups.values()).sort((a, b) => {
    const cycleCmp = (cycleById.get(b.cycleId)?.cycle_month ?? "").localeCompare(
      cycleById.get(a.cycleId)?.cycle_month ?? ""
    );
    if (cycleCmp !== 0) return cycleCmp;
    return (branchNameById.get(a.branchId) ?? "").localeCompare(branchNameById.get(b.branchId) ?? "");
  });

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Review</h1>
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2">Cycle</th>
              <th className="px-4 py-2">Branch</th>
              <th className="px-4 py-2">Submitted</th>
              <th className="px-4 py-2">Reviewed</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r) => (
              <tr key={`${r.cycleId}:${r.branchId}`}>
                <td className="px-4 py-2 text-neutral-900">
                  {cycleById.get(r.cycleId)?.cycle_month.slice(0, 7)}
                </td>
                <td className="px-4 py-2 text-neutral-600">{branchNameById.get(r.branchId)}</td>
                <td className="px-4 py-2 text-neutral-600">
                  {r.submitted} / {r.total}
                </td>
                <td className="px-4 py-2 text-neutral-600">
                  {r.reviewed} / {r.total}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link
                    href={`/admin/review/${r.cycleId}/${r.branchId}`}
                    className="text-sm text-brand hover:underline"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">
                  Nothing to review yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
