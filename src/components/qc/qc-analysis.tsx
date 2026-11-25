import Link from "next/link";
import type { QcAnalysis, QcGroupRow } from "@/lib/qc/server";
import { QC_RANGES, type QcRangeKey } from "@/lib/qc/range";
import { purposeLabel, repairTypeLabel } from "@/lib/qc/constants";
import { QcCards } from "./qc-cards";

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
const dayName = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
/** "25 Oct 2026 → 25 Nov 2026"; for All time, "all time, up to 25 Nov 2026". */
export function qcPeriodLabel(a: Pick<QcAnalysis, "startDay" | "endDay">): string {
  const f = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return a.startDay ? `${f(a.startDay)} → ${f(a.endDay)}` : `all time, up to ${f(a.endDay)}`;
}

/** Rows of one breakdown: vehicles, first-time pass rate (with a bar), fails, tests per vehicle. */
function Breakdown({ title, rows, label = (k) => k, perTest }: { title: string; rows: QcGroupRow[]; label?: (k: string) => string; perTest?: boolean }) {
  if (!rows.length) return null;
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-neutral-200/70">
      <div className="border-b border-neutral-100 px-4 py-2.5 text-sm font-bold text-neutral-900">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-neutral-500">
            <tr className="text-left">
              <th className="px-4 py-2 font-medium"></th>
              <th className="px-2 py-2 text-right font-medium">Vehicles</th>
              <th className="px-2 py-2 font-medium">First-time pass</th>
              <th className="px-2 py-2 text-right font-medium">{perTest ? "Fails / tests" : "Fails"}</th>
              <th className="px-4 py-2 text-right font-medium">Tests per vehicle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r) => {
              const rate = r.checks ? r.firstPass / r.checks : 0;
              return (
                <tr key={r.key}>
                  <td className="px-4 py-2 font-medium text-neutral-900">{label(r.key)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.checks}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-neutral-100">
                        <div className={`h-full ${rate >= 0.9 ? "bg-emerald-500" : rate >= 0.75 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${Math.round(rate * 100)}%` }} />
                      </div>
                      <span className="tabular-nums">{pct(r.firstPass, r.checks)}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{perTest ? `${r.fails} / ${r.tests}` : r.fails}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.checks ? (r.tests / r.checks).toFixed(2) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The period buttons (1 week ... All time) as links: the quality controller's page. The dashboard has the same buttons in its own filter bar. */
export function QcRangePills({ action, range, branches, branchId, extra = {} }: { action: string; range: QcRangeKey; branches?: { id: string; name: string }[]; branchId?: string; /** Other parameters of the page kept when the period changes (the records list: status, search). */ extra?: Record<string, string> }) {
  const href = (key: string) => `${action}?${new URLSearchParams({ ...extra, ...(branchId ? { branch: branchId } : {}), qc: key })}`;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-neutral-200/70">
      <div className="flex flex-wrap gap-1 rounded-xl bg-neutral-100 p-1">
        {QC_RANGES.map((r) => (
          <Link key={r.key} href={href(r.key)} className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition ${r.key === range ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-900"}`}>
            {r.label}
          </Link>
        ))}
      </div>
      {branches && (
        <form action={action} className="flex items-center gap-2">
          <input type="hidden" name="qc" value={range} />
          {Object.entries(extra).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <select name="branch" defaultValue={branchId ?? ""} className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm">
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white">Show</button>
        </form>
      )}
    </div>
  );
}

/** Quality KPIs of the quality control department. */
export function QcAnalysisView({ a, showBranches, recordsHref }: { a: QcAnalysis; showBranches?: boolean; /** Where one QC opens: recordsHref/<id>. */ recordsHref: string }) {
  const maxBucket = Math.max(1, ...a.buckets.map((m) => m.checks));
  return (
    <div className="space-y-4">
      <QcCards a={a} recordsHref={recordsHref} showBranches={!!showBranches} />

      <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-bold text-neutral-900">{a.bucketUnit === "day" ? "By day" : "By month"}</div>
          <div className="flex gap-3 text-xs text-neutral-500">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> passed first time
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm bg-red-400" /> failed first time
            </span>
          </div>
        </div>
        <div className="flex h-44 items-end gap-2 overflow-x-auto">
          {a.buckets.map((m) => (
            <div key={m.key} className="flex min-w-10 flex-1 flex-col items-center gap-1">
              <div className="text-[11px] font-semibold text-neutral-700 tabular-nums">{m.checks ? pct(m.firstPass, m.checks) : ""}</div>
              <div className="flex w-full max-w-12 flex-col-reverse overflow-hidden rounded-t" style={{ height: `${(m.checks / maxBucket) * 120}px` }}>
                <div className="bg-emerald-500" style={{ height: `${m.checks ? (m.firstPass / m.checks) * 100 : 0}%` }} />
                <div className="flex-1 bg-red-400" />
              </div>
              <div className="text-[11px] text-neutral-500">{a.bucketUnit === "day" ? dayName(m.key) : monthName(m.key)}</div>
              <div className="text-[11px] text-neutral-400 tabular-nums">{m.checks}</div>
            </div>
          ))}
        </div>
      </div>

      {showBranches && <Breakdown title="By branch" rows={a.byBranch} />}
      <Breakdown title="By technician" rows={a.byTechnician} perTest />
      <Breakdown title="By team leader" rows={a.byTeamLeader} />
      <Breakdown title="By purpose" rows={a.byPurpose} label={purposeLabel} />
      <Breakdown title="By repair type" rows={a.byRepairType} label={repairTypeLabel} />
      <Breakdown title="By vehicle model" rows={a.byModel} />
      <Breakdown title="By quality controller" rows={a.byController} />

      {a.topFailReasons.length > 0 && (
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
          <div className="mb-2 text-sm font-bold text-neutral-900">Most frequent fail notes</div>
          <ul className="space-y-1 text-sm">
            {a.topFailReasons.map((r) => (
              <li key={r.text} className="flex justify-between gap-3">
                <span className="min-w-0 truncate text-neutral-800">{r.text}</span>
                <span className="text-neutral-500 tabular-nums">{r.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!a.checks && <p className="rounded-xl bg-white p-6 text-center text-sm text-neutral-500 shadow-sm ring-1 ring-neutral-200/70">No QC in this period.</p>}
    </div>
  );
}
