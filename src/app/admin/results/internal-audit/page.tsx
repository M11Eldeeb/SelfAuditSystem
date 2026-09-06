import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { scoreBadgeClasses } from "@/lib/score-color";
import { DeleteInternalAuditButton } from "@/app/admin/internal-audit/delete-internal-audit-button";

export default async function InternalAuditResultsPage() {
  const supabase = await createClient();

  const [{ data: branches }, { data: audits }] = await Promise.all([
    supabase.from("self_audit_branches").select("id, name").order("name"),
    supabase
      .from("self_audit_internal_audits")
      .select("*")
      .eq("status", "finalized")
      .order("finalized_at", { ascending: false }),
  ]);

  const branchNameById = new Map((branches ?? []).map((b) => [b.id, b.name]));

  return (
    <div className="space-y-3">
      <div>
        <Link href="/admin/results" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to results
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">Internal Audits</h1>
        <p className="text-sm text-neutral-600">Finalized internal audit results.</p>
      </div>
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Branch</th>
              <th className="px-4 py-2">Finalized</th>
              <th className="px-4 py-2">Score</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {(audits ?? []).map((a) => (
              <tr key={a.id}>
                <td className="px-4 py-2 text-neutral-900">{a.name ?? "—"}</td>
                <td className="px-4 py-2 text-neutral-600">
                  {a.branch_id ? (branchNameById.get(a.branch_id) ?? "Unknown branch") : "All branches"}
                </td>
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
            {(audits ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">
                  No internal audits have been finalized yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
