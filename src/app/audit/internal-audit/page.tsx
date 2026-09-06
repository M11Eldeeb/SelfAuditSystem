import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { scoreBadgeClasses } from "@/lib/score-color";

export default async function BranchInternalAuditResultsPage() {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();

  const { data: audits } = await supabase
    .from("self_audit_internal_audits")
    .select("*")
    .eq("branch_id", user.branch_id!)
    .eq("status", "finalized")
    .order("finalized_at", { ascending: false });

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Internal Audit Results</h1>
        <p className="text-sm text-neutral-600">
          Finalized internal audits conducted for your branch by a warranty officer.
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2">Name</th>
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
                  <Link href={`/audit/internal-audit/${a.id}`} className="text-sm text-brand hover:underline">
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {(audits ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-neutral-400">
                  No internal audits have been finalized for your branch yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
