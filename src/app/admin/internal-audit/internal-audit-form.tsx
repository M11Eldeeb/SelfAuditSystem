"use client";

import { useActionState, useState } from "react";
import { previewInternalAuditSample, startInternalAudit, type InternalAuditPreviewClaim } from "./actions";
import { generateSamplePreviewExcel } from "@/lib/internal-audit-sample-excel";

type Branch = { id: string; name: string; code: string };

function currentQuarter(): number {
  return Math.ceil((new Date().getMonth() + 1) / 3);
}

function defaultAuditName(branchCode: string | null, branchLabel: string): string {
  const who = branchCode ? `${branchCode} - ${branchLabel}` : branchLabel;
  return `${who} - Internal Audit - Q${currentQuarter()}`;
}

function buildAuditEmail({
  branchAdminEmail,
  branchLabel,
  auditDate,
  auditorName,
}: {
  branchAdminEmail: string;
  branchLabel: string;
  auditDate: string;
  auditorName: string;
}): string {
  const subject = `Internal Audit Notice - ${branchLabel}`;
  const body = [
    `Dear ${branchLabel} team,`,
    "",
    `Please be informed that the Warranty department will be conducting an internal audit${
      auditDate ? ` on ${auditDate}` : ""
    }.`,
    "Attached is the list of claims selected for this audit - please have the related job cards, parts and documentation ready for review.",
    "",
    "Best regards,",
    auditorName || "",
  ].join("\n");
  return `mailto:${encodeURIComponent(branchAdminEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function InternalAuditForm({ branches, officerName }: { branches: Branch[]; officerName: string }) {
  const [previewState, previewAction, previewPending] = useActionState(previewInternalAuditSample, undefined);

  const claims = previewState?.claims ?? [];

  return (
    <div className="space-y-4">
      <form action={previewAction} className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="branch_id" className="text-xs font-medium text-neutral-700">
              Branch
            </label>
            <select
              id="branch_id"
              name="branch_id"
              defaultValue=""
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900"
            >
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="date_from" className="text-xs font-medium text-neutral-700">
              Submitted from
            </label>
            <input
              id="date_from"
              name="date_from"
              type="date"
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="date_to" className="text-xs font-medium text-neutral-700">
              Submitted to
            </label>
            <input
              id="date_to"
              name="date_to"
              type="date"
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="sample_size" className="text-xs font-medium text-neutral-700">
              Sample size
            </label>
            <input
              id="sample_size"
              name="sample_size"
              type="number"
              min={1}
              required
              defaultValue={15}
              className="w-24 rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="sample_mode" className="text-xs font-medium text-neutral-700">
              Sample mode
            </label>
            <select
              id="sample_mode"
              name="sample_mode"
              defaultValue="flagged"
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900"
            >
              <option value="flagged">Highest audit flag first (risk-based)</option>
              <option value="random">Random</option>
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="max_per_part" className="text-xs font-medium text-neutral-700">
              Max per labor code
            </label>
            <input
              id="max_per_part"
              name="max_per_part"
              type="number"
              min={1}
              placeholder="No limit"
              className="w-28 rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900"
            />
          </div>
          <button
            type="submit"
            disabled={previewPending}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
          >
            {previewPending ? "Sampling..." : "Generate sample"}
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          Caps how many sampled claims can share the same repair (grouped by labor code) so the sample
          isn&apos;t dominated by one repair type. Claims already covered by self-audit or a past
          internal audit are automatically excluded. Review the sample below before starting the audit.
        </p>
        {previewState?.error && <p className="text-sm text-red-600">{previewState.error}</p>}
      </form>

      {claims.length > 0 && (
        <SamplePreviewPanel
          // Remounts (resetting the setup fields below to fresh defaults) only
          // when a genuinely new sample is generated, not on every keystroke.
          key={`${previewState?.branchId ?? "all"}-${claims.length}-${previewState?.sampleMode}`}
          claims={claims}
          branchId={previewState?.branchId ?? null}
          branchCode={previewState?.branchCode ?? null}
          branchLabel={previewState?.branchLabel ?? "All branches"}
          branchAdminEmail={previewState?.branchAdminEmail ?? null}
          dateFrom={previewState?.dateFrom ?? null}
          dateTo={previewState?.dateTo ?? null}
          sampleSize={previewState?.sampleSize ?? claims.length}
          sampleMode={previewState?.sampleMode ?? "random"}
          maxPerPart={previewState?.maxPerPart ?? null}
          officerName={officerName}
        />
      )}
    </div>
  );
}

function SamplePreviewPanel({
  claims,
  branchId,
  branchCode,
  branchLabel,
  branchAdminEmail,
  dateFrom,
  dateTo,
  sampleSize,
  sampleMode,
  maxPerPart,
  officerName,
}: {
  claims: InternalAuditPreviewClaim[];
  branchId: string | null;
  branchCode: string | null;
  branchLabel: string;
  branchAdminEmail: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  sampleSize: number;
  sampleMode: "flagged" | "random";
  maxPerPart: number | null;
  officerName: string;
}) {
  const [startState, startAction, startPending] = useActionState(startInternalAudit, undefined);
  const [auditName, setAuditName] = useState(() => defaultAuditName(branchCode, branchLabel));
  const [auditorName, setAuditorName] = useState(officerName);
  const [managerName, setManagerName] = useState("");
  const [auditDate, setAuditDate] = useState("");
  const showFlag = sampleMode === "flagged";

  return (
    <div className="space-y-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-neutral-900">
          Proposed sample - {claims.length} claim{claims.length === 1 ? "" : "s"} ({branchLabel})
        </h3>
        <button
          type="button"
          onClick={() => generateSamplePreviewExcel(claims)}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50"
        >
          Download as Excel
        </button>
      </div>

      <div className="overflow-x-auto rounded-md border border-neutral-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-neutral-50 text-left font-medium uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2">Claim #</th>
              <th className="px-3 py-2">WO #</th>
              <th className="px-3 py-2">VIN</th>
              <th className="px-3 py-2">Branch</th>
              <th className="px-3 py-2">Submit date</th>
              <th className="px-3 py-2">Main part name</th>
              {showFlag && <th className="px-3 py-2">Risk</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {claims.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-1.5 text-neutral-900">{c.claim_number}</td>
                <td className="px-3 py-1.5 text-neutral-600">{c.work_order_no ?? "—"}</td>
                <td className="px-3 py-1.5 text-neutral-600">{c.vin ?? "—"}</td>
                <td className="px-3 py-1.5 text-neutral-600">{c.branch_name}</td>
                <td className="px-3 py-1.5 text-neutral-600">{c.dealer_submit_date ?? "—"}</td>
                <td className="px-3 py-1.5 text-neutral-600">{c.main_part_name ?? "—"}</td>
                {showFlag && <td className="px-3 py-1.5 text-neutral-600">{c.flag_score ?? "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 rounded-md border border-neutral-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <label htmlFor="audit_name_input" className="text-xs font-medium text-neutral-700">
            Audit name
          </label>
          <input
            id="audit_name_input"
            value={auditName}
            onChange={(e) => setAuditName(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="auditor_name_input" className="text-xs font-medium text-neutral-700">
            Auditor name
          </label>
          <input
            id="auditor_name_input"
            value={auditorName}
            onChange={(e) => setAuditorName(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="manager_name_input" className="text-xs font-medium text-neutral-700">
            Service manager name
          </label>
          <input
            id="manager_name_input"
            value={managerName}
            onChange={(e) => setManagerName(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="audit_date_input" className="text-xs font-medium text-neutral-700">
            Audit date
          </label>
          <input
            id="audit_date_input"
            type="date"
            value={auditDate}
            onChange={(e) => setAuditDate(e.target.value)}
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!branchAdminEmail}
          title={
            branchAdminEmail ? undefined : "No branch admin email found for this branch (or 'All branches' is selected)."
          }
          onClick={() => {
            if (!branchAdminEmail) return;
            generateSamplePreviewExcel(claims);
            window.location.href = buildAuditEmail({
              branchAdminEmail,
              branchLabel,
              auditDate,
              auditorName,
            });
          }}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send Audit Email to branch admin
        </button>
        <p className="text-xs text-neutral-500">
          Downloads the Excel sheet and opens your email app with the branch admin, subject and message
          filled in - email links can&apos;t attach files automatically, so attach the file that just
          downloaded before sending.
        </p>
      </div>

      <form action={startAction} className="flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-3">
        <input type="hidden" name="branch_id" value={branchId ?? ""} />
        <input type="hidden" name="date_from" value={dateFrom ?? ""} />
        <input type="hidden" name="date_to" value={dateTo ?? ""} />
        <input type="hidden" name="sample_size" value={sampleSize} />
        <input type="hidden" name="sample_mode" value={sampleMode} />
        <input type="hidden" name="max_per_part" value={maxPerPart ?? ""} />
        <input type="hidden" name="name" value={auditName} />
        <input type="hidden" name="auditor_name" value={auditorName} />
        <input type="hidden" name="manager_name" value={managerName} />
        <input type="hidden" name="audit_date" value={auditDate} />
        {claims.map((c) => (
          <input key={c.id} type="hidden" name="claim_id" value={c.id} />
        ))}
        <button
          type="submit"
          disabled={startPending || !auditName.trim() || !auditorName.trim() || !managerName.trim()}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {startPending ? "Starting..." : "Start internal audit with this sample"}
        </button>
        {(!auditName.trim() || !auditorName.trim() || !managerName.trim()) && (
          <p className="text-xs text-neutral-500">Fill in audit name, auditor name and service manager name to start.</p>
        )}
        {startState?.error && <p className="text-sm text-red-600">{startState.error}</p>}
      </form>
    </div>
  );
}
