import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { scoreBadgeClasses } from "@/lib/score-color";
import { DeleteInternalAuditButton } from "@/app/admin/internal-audit/delete-internal-audit-button";
import { HistoricalInternalAuditForm } from "./historical-audit-form";

export default async function InternalAuditResultsPage() {
  const supabase = await createClient();

  const [{ data: branches }, { data: audits }, { data: historical }] = await Promise.all([
    supabase.from("self_audit_branches").select("id, name").order("name"),
    supabase.from("self_audit_internal_audits").select("*").eq("status", "finalized"),
    supabase.from("self_audit_historical_audits").select("branch_id").eq("audit_type", "internal_audit"),
  ]);

  const countByBranch = new Map<string, number>();
  (audits ?? []).forEach((a) => {
    if (!a.branch_id) return;
    countByBranch.set(a.branch_id, (countByBranch.get(a.branch_id) ?? 0) + 1);
  });
  (historical ?? []).forEach((h) => {
    countByBranch.set(h.branch_id, (countByBranch.get(h.branch_id) ?? 0) + 1);
  });

  const allBranchesAudits = (audits ?? [])
    .filter((a) => !a.branch_id)
    .sort((a, b) => (b.finalized_at ?? "").localeCompare(a.finalized_at ?? ""));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/results" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to results
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">Internal Audits</h1>
        <p className="text-sm text-neutral-600">Pick a branch to see its finalized internal audit results.</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Branches</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(branches ?? []).map((b) => (
            <Link
              key={b.id}
              href={`/admin/results/internal-audit/${b.id}`}
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
          <HistoricalInternalAuditForm branches={branches ?? []} />
        </div>
      </details>

      {allBranchesAudits.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-neutral-900">All-branches audits</h2>
          <p className="text-sm text-neutral-600">Internal audits not scoped to a single branch.</p>
          <div className="overflow-hidden rounded-xl border border-neutral-200/70 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs font-semibold tracking-wide text-neutral-500 uppercase border-b border-neutral-200">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Finalized</th>
                  <th className="px-4 py-2">Score</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {allBranchesAudits.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-2 text-neutral-900">{a.name ?? "—"}</td>
                    <td className="px-4 py-2 text-neutral-600">
                      {a.finalized_at ? new Date(a.finalized_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {a.score_pct != null ? (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${scoreBadgeClasses(a.score_pct)}`}>
                          {a.score_pct}%
                        </span>
                      ) : (
                        <span className="text-neutral-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Link href={`/admin/internal-audit/${a.id}/report`} className="text-sm text-brand hover:underline">
                          View report
                        </Link>
                        <DeleteInternalAuditButton auditId={a.id} />
                      </div>
                    </td>
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
