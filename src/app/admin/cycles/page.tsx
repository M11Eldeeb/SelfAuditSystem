import { createClient } from "@/lib/supabase/server";
import { CycleForm } from "./cycle-form";
import { DeleteCycleButton } from "./delete-cycle-button";

export default async function CyclesPage() {
  const supabase = await createClient();

  const [{ data: cycles }, { data: assignments }] = await Promise.all([
    supabase.from("self_audit_audit_cycles").select("*").order("cycle_month", { ascending: false }),
    supabase.from("self_audit_audit_assignments").select("cycle_id, status"),
  ]);

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

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Generate audit cycle</h1>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <CycleForm />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Cycles</h2>
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
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
    </div>
  );
}
