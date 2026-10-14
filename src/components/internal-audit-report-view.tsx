import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadInternalAuditReport } from "@/lib/internal-audit-report-data";
import { scoreBadgeClasses } from "@/lib/score-color";
import { ReportActions } from "@/app/admin/(audits)/internal-audit/[id]/report/download-report-button";

/**
 * Shared, read-only rendering of a finalized internal audit's results - used
 * by the officer's own report page and by the branch admin's own view of
 * their branch's results (RLS scopes what each role can actually fetch).
 */
export async function InternalAuditReportView({
  auditId,
  backHref,
  backLabel,
  showEmailButton = true,
}: {
  auditId: string;
  backHref: string;
  backLabel: string;
  showEmailButton?: boolean;
}) {
  const supabase = await createClient();
  const report = await loadInternalAuditReport(supabase, auditId);
  if (!report) notFound();
  const { audit, branchName, overallScore, departmentScores, recommendations, departmentRemarks, pdf } = report;
  const { auditorName, auditDateLabel } = pdf;

  // Whether the results e-mail has already gone out (the officer's button shows it; a branch admin never sees the button).
  let resultsSentAt: string | null = null;
  if (showEmailButton) {
    const { data: sent } = await supabase
      .from("self_audit_email_log")
      .select("sent_at")
      .eq("dedupe_key", `internal-audit-results:${auditId}`)
      .eq("status", "sent")
      .maybeSingle();
    resultsSentAt = sent?.sent_at ?? null;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={backHref} className="text-sm text-neutral-500 hover:text-neutral-800">
            &larr; {backLabel}
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">
            {audit.name || `Internal Audit Report - ${branchName}`}
          </h1>
          <p className="text-sm text-neutral-500">
            {auditDateLabel} &middot; Auditor: {auditorName || "—"} &middot; Service manager:{" "}
            {audit.manager_name || "—"}
          </p>
        </div>
        <ReportActions data={pdf} auditId={auditId} showEmailButton={showEmailButton} resultsSentAt={resultsSentAt} />
      </div>

      <div className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-lg font-semibold ${scoreBadgeClasses(overallScore)}`}>
            {overallScore}%
          </span>
          <span className="text-sm text-neutral-500">Overall score</span>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Department scores</h2>
        <div className="space-y-2 rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
          {departmentScores.map((d) => (
            <div key={d.departmentId} className="flex items-center gap-3">
              <span className="w-48 shrink-0 text-sm text-neutral-900">{d.label}</span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className={`h-full rounded-full ${d.pct != null && d.pct >= 90 ? "bg-emerald-500" : d.pct != null && d.pct >= 75 ? "bg-amber-500" : "bg-red-500"}`}
                  style={{ width: `${Math.min(d.pct ?? 0, 100)}%` }}
                />
              </div>
              <span className="w-16 text-right text-sm font-medium text-neutral-900">
                {d.pct != null ? `${d.pct}%` : "—"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Recommendations</h2>
        {recommendations.length === 0 ? (
          <p className="text-sm text-neutral-500">No open findings below the 80% threshold.</p>
        ) : (
          <div className="space-y-2">
            {recommendations.map((r, i) => (
              <div key={i} className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
                <p className="text-sm font-medium text-neutral-900">
                  {r.dept} &middot; {r.checkpoint} ({r.pct}%)
                </p>
                <p className="mt-1 text-sm text-neutral-600">{r.text}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {departmentRemarks.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-neutral-900">Auditor remarks</h2>
          <div className="space-y-2 rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
            {departmentRemarks.map((r, i) => (
              <div key={i}>
                <p className="text-sm font-medium text-neutral-900">{r.label}</p>
                <p className="text-sm text-neutral-600">{r.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {audit.branch_ops_note && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-neutral-900">Branch Operation note</h2>
          <p className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 text-sm text-neutral-700">
            {audit.branch_ops_note}
          </p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Closing statement</h2>
        <p className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 text-sm text-neutral-700">
          {audit.closing_statement || "—"}
        </p>
      </section>
    </div>
  );
}
