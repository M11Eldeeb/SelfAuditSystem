import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { scoreBadgeClasses } from "@/lib/score-color";
import { getWarrantyRoomFileUrl } from "@/lib/warranty-room/file-url";

export default async function BranchInternalAuditResultsPage() {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();

  const [{ data: internalAudits }, { data: historical }] = await Promise.all([
    supabase
      .from("self_audit_internal_audits")
      .select("*")
      .eq("branch_id", user.branch_id!)
      .eq("status", "finalized"),
    supabase
      .from("self_audit_historical_audits")
      .select("*")
      .eq("branch_id", user.branch_id!)
      .eq("audit_type", "internal_audit"),
  ]);

  const historicalWithUrl = await Promise.all(
    (historical ?? []).map(async (h) => ({ ...h, pdfUrl: await getWarrantyRoomFileUrl(supabase, h.pdf_path) }))
  );

  type Row =
    | { kind: "live"; date: string; name: string | null; scorePct: number | null; id: string }
    | { kind: "historical"; date: string; scorePct: number; pdfUrl: string | null };

  const rows: Row[] = [
    ...(internalAudits ?? []).map((a) => ({
      kind: "live" as const,
      date: a.finalized_at ?? a.created_at,
      name: a.name,
      scorePct: a.score_pct,
      id: a.id,
    })),
    ...historicalWithUrl.map((h) => ({
      kind: "historical" as const,
      date: h.period_month,
      scorePct: h.score_pct,
      pdfUrl: h.pdfUrl,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="space-y-3">
      <div>
        <Link href="/audit/results" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to results
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">Internal Audits</h1>
        <p className="text-sm text-neutral-600">Your branch&apos;s finalized internal-audit results.</p>
      </div>
      <div className="overflow-hidden rounded-xl border border-neutral-200/70 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-semibold tracking-wide text-neutral-500 uppercase border-b border-neutral-200">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Score</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-4 py-2 text-neutral-900">{r.date.slice(0, 7)}</td>
                <td className="px-4 py-2">
                  {r.kind === "historical" ? (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                      Historical
                    </span>
                  ) : (
                    <span className="text-neutral-500">{r.name ?? "Internal audit"}</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {r.scorePct != null ? (
                    <span className={`inline-block rounded px-2 py-1 font-medium ${scoreBadgeClasses(r.scorePct)}`}>
                      {r.scorePct}%
                    </span>
                  ) : (
                    <span className="text-neutral-300">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  {r.kind === "live" ? (
                    <Link href={`/audit/internal-audit/${r.id}`} className="text-sm text-brand hover:underline">
                      View
                    </Link>
                  ) : r.pdfUrl ? (
                    <a href={r.pdfUrl} target="_blank" rel="noreferrer" className="text-sm text-brand hover:underline">
                      View PDF
                    </a>
                  ) : (
                    <span className="text-sm text-neutral-300">No PDF</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-neutral-400">
                  No internal audit results yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
