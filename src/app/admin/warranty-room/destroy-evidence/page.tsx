import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function DestroyEvidenceCyclesPage() {
  await requireRole("officer");
  const supabase = await createClient();

  const [{ data: cycles }, { data: evidence }] = await Promise.all([
    supabase.from("self_audit_audit_cycles").select("id, cycle_month").order("cycle_month", { ascending: false }),
    supabase.from("self_audit_destroy_evidence").select("cycle_id, status"),
  ]);

  const submittedCountByCycle = new Map<string, number>();
  const sentCountByCycle = new Map<string, number>();
  (evidence ?? []).forEach((e) => {
    if (e.status === "submitted") submittedCountByCycle.set(e.cycle_id, (submittedCountByCycle.get(e.cycle_id) ?? 0) + 1);
    if (e.status === "sent") sentCountByCycle.set(e.cycle_id, (sentCountByCycle.get(e.cycle_id) ?? 0) + 1);
  });

  const cyclesWithEvidence = (cycles ?? []).filter(
    (c) => (submittedCountByCycle.get(c.id) ?? 0) > 0 || (sentCountByCycle.get(c.id) ?? 0) > 0
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/warranty-room" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to Warranty Room
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">Destroy evidence</h1>
        <p className="text-sm text-neutral-600">
          One bulk destruction-video submission per branch per self-audit cycle. Downloading a branch&apos;s videos
          removes them from storage and marks that branch sent for the cycle.
        </p>
      </div>

      {cyclesWithEvidence.length === 0 && (
        <p className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 text-sm text-neutral-400">
          Nothing submitted yet.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cyclesWithEvidence.map((c) => (
          <Link
            key={c.id}
            href={`/admin/warranty-room/destroy-evidence/${c.id}`}
            className="flex flex-col gap-1 rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 transition hover:border-brand hover:shadow-md hover:-translate-y-0.5"
          >
            <p className="text-sm font-semibold text-neutral-900">{c.cycle_month.slice(0, 7)}</p>
            <p className="text-xs text-neutral-500">
              {submittedCountByCycle.get(c.id) ?? 0} awaiting collection, {sentCountByCycle.get(c.id) ?? 0} collected
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
