"use client";

import { useActionState } from "react";
import { previewInternalAuditSample, startInternalAudit } from "./actions";
import { generateSamplePreviewExcel } from "@/lib/internal-audit-sample-excel";

type Branch = { id: string; name: string };

export function InternalAuditForm({ branches }: { branches: Branch[] }) {
  const [previewState, previewAction, previewPending] = useActionState(previewInternalAuditSample, undefined);
  const [startState, startAction, startPending] = useActionState(startInternalAudit, undefined);

  const claims = previewState?.claims ?? [];
  const showFlag = previewState?.sampleMode === "flagged";

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
        <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-neutral-900">
              Proposed sample - {claims.length} claim{claims.length === 1 ? "" : "s"} ({previewState?.branchLabel})
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
                  <th className="px-3 py-2">Labor code</th>
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
                    <td className="px-3 py-1.5 text-neutral-600">{c.labor_code ?? "—"}</td>
                    {showFlag && <td className="px-3 py-1.5 text-neutral-600">{c.flag_score ?? "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={startAction} className="flex items-center gap-3">
            <input type="hidden" name="branch_id" value={previewState?.branchId ?? ""} />
            <input type="hidden" name="date_from" value={previewState?.dateFrom ?? ""} />
            <input type="hidden" name="date_to" value={previewState?.dateTo ?? ""} />
            <input type="hidden" name="sample_size" value={previewState?.sampleSize ?? claims.length} />
            <input type="hidden" name="sample_mode" value={previewState?.sampleMode ?? "random"} />
            <input type="hidden" name="max_per_part" value={previewState?.maxPerPart ?? ""} />
            {claims.map((c) => (
              <input key={c.id} type="hidden" name="claim_id" value={c.id} />
            ))}
            <button
              type="submit"
              disabled={startPending}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
            >
              {startPending ? "Starting..." : "Start internal audit with this sample"}
            </button>
            {startState?.error && <p className="text-sm text-red-600">{startState.error}</p>}
          </form>
        </div>
      )}
    </div>
  );
}
