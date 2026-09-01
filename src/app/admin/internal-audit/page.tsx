import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { InternalAuditForm } from "./internal-audit-form";
import { DeleteInternalAuditButton } from "./delete-internal-audit-button";
import { scoreBadgeClasses } from "@/lib/score-color";

export default async function InternalAuditPage() {
  const supabase = await createClient();

  const [{ data: branches }, { data: audits }] = await Promise.all([
    supabase.from("self_audit_branches").select("id, name").order("name"),
    supabase.from("self_audit_internal_audits").select("*").order("created_at", { ascending: false }),
  ]);

  const branchNameById = new Map((branches ?? []).map((b) => [b.id, b.name]));

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Internal Audit</h1>
        <p className="text-sm text-neutral-600">
          Officer-led sampling of claims across Documents, Parts and Branch Operation checkpoints -
          separate from the monthly branch self-audit. A claim audited by either workflow is never
          resampled by the other.
        </p>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <InternalAuditForm branches={branches ?? []} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Past internal audits</h2>
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-2">Branch</th>
                <th className="px-4 py-2">Date range</th>
                <th className="px-4 py-2">Sample</th>
                <th className="px-4 py-2">Mode</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Score</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {(audits ?? []).map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2 text-neutral-900">
                    {a.branch_id ? (branchNameById.get(a.branch_id) ?? "Unknown branch") : "All branches"}
                  </td>
                  <td className="px-4 py-2 text-neutral-600">
                    {a.date_from || a.date_to ? `${a.date_from ?? "…"} to ${a.date_to ?? "…"}` : "—"}
                  </td>
                  <td className="px-4 py-2 text-neutral-600">{a.sample_size}</td>
                  <td className="px-4 py-2 text-neutral-600 capitalize">{a.sample_mode}</td>
                  <td className="px-4 py-2 text-neutral-600 capitalize">
                    {a.status === "finalized" ? "Finalized" : "In progress"}
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
                      <Link
                        href={
                          a.status === "finalized"
                            ? `/admin/internal-audit/${a.id}/report`
                            : `/admin/internal-audit/${a.id}?claim=0`
                        }
                        className="text-sm text-brand hover:underline"
                      >
                        {a.status === "finalized" ? "View report" : "Continue"}
                      </Link>
                      {a.status !== "finalized" && <DeleteInternalAuditButton auditId={a.id} />}
                    </div>
                  </td>
                </tr>
              ))}
              {(audits ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-neutral-400">
                    No internal audits yet.
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
