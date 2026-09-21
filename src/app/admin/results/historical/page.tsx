import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { scoreBadgeClasses } from "@/lib/score-color";
import { getWarrantyRoomFileUrl } from "@/lib/warranty-room/file-url";
import { HistoricalAuditForm } from "./historical-audit-form";
import { DeleteHistoricalAuditButton } from "./delete-historical-audit-button";

const AUDIT_TYPE_LABELS: Record<string, string> = {
  self_audit: "Self Audit",
  internal_audit: "Internal Audit",
};

export default async function HistoricalAuditsPage() {
  const supabase = await createClient();

  const [{ data: branches }, { data: entries }] = await Promise.all([
    supabase.from("self_audit_branches").select("id, name").order("name"),
    supabase
      .from("self_audit_historical_audits")
      .select("*")
      .order("period_month", { ascending: false }),
  ]);

  const branchNameById = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const entriesWithUrl = await Promise.all(
    (entries ?? []).map(async (e) => ({ ...e, pdfUrl: await getWarrantyRoomFileUrl(supabase, e.pdf_path) }))
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/results" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to results
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">Historical Audits</h1>
        <p className="text-sm text-neutral-600">
          Self-audit or internal-audit results from before this website existed, one branch and month
          at a time, each backed by the original report PDF.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Add entry</h2>
        <div className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
          <HistoricalAuditForm branches={branches ?? []} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Entries</h2>
        <div className="overflow-hidden rounded-xl border border-neutral-200/70 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-semibold tracking-wide text-neutral-500 uppercase border-b border-neutral-200">
              <tr>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Branch</th>
                <th className="px-4 py-2">Month</th>
                <th className="px-4 py-2">Score</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {entriesWithUrl.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                      Historical &middot; {AUDIT_TYPE_LABELS[e.audit_type] ?? e.audit_type}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-neutral-900">
                    {branchNameById.get(e.branch_id) ?? "Unknown branch"}
                  </td>
                  <td className="px-4 py-2 text-neutral-600">{e.period_month.slice(0, 7)}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${scoreBadgeClasses(e.score_pct)}`}>
                      {e.score_pct}%
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {e.pdfUrl ? (
                        <a href={e.pdfUrl} target="_blank" rel="noreferrer" className="text-sm text-brand hover:underline">
                          View PDF
                        </a>
                      ) : (
                        <span className="text-sm text-neutral-300">No PDF</span>
                      )}
                      <DeleteHistoricalAuditButton id={e.id} />
                    </div>
                  </td>
                </tr>
              ))}
              {entriesWithUrl.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">
                    No historical audits added yet.
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
