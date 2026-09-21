import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { HistoricalSelfAuditForm } from "./historical-audit-form";

export default async function SelfAuditResultsPage() {
  const supabase = await createClient();

  const [{ data: branches }, { data: results }, { data: historical }] = await Promise.all([
    supabase.from("self_audit_branches").select("id, name").order("name"),
    supabase.from("self_audit_audit_results").select("branch_id"),
    supabase.from("self_audit_historical_audits").select("branch_id").eq("audit_type", "self_audit"),
  ]);

  const countByBranch = new Map<string, number>();
  [...(results ?? []), ...(historical ?? [])].forEach((r) => {
    countByBranch.set(r.branch_id, (countByBranch.get(r.branch_id) ?? 0) + 1);
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/results" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to results
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">Self Audits</h1>
        <p className="text-sm text-neutral-600">
          Pick a branch to see its finalized self-audit results. For a branch-vs-branch comparison,
          see Overview.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Branches</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(branches ?? []).map((b) => (
            <Link
              key={b.id}
              href={`/admin/results/self-audit/${b.id}`}
              className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 transition hover:border-brand hover:shadow-md hover:-translate-y-0.5"
            >
              <p className="font-medium text-neutral-900">{b.name}</p>
              <p className="text-xs text-neutral-500">
                {countByBranch.get(b.id) ?? 0} result{countByBranch.get(b.id) === 1 ? "" : "s"}
              </p>
            </Link>
          ))}
          {(branches ?? []).length === 0 && <p className="text-sm text-neutral-400">No branches yet.</p>}
        </div>
      </section>

      <details className="group rounded-xl border border-neutral-200/70 bg-white shadow-sm">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-neutral-700 marker:content-none">
          <span className="inline-flex items-center gap-1.5">
            <span className="text-neutral-400 transition-transform group-open:rotate-90">&rsaquo;</span>
            Add historical result
          </span>
        </summary>
        <div className="border-t border-neutral-200/70 p-4">
          <HistoricalSelfAuditForm branches={branches ?? []} />
        </div>
      </details>
    </div>
  );
}
