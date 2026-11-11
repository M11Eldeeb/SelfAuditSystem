import type { QcAnalysis, QcGroupRow } from "@/lib/qc/server";
import { purposeLabel, repairTypeLabel } from "@/lib/qc/constants";

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

function Tile({ title, value, sub, tone = "neutral" }: { title: string; value: string; sub?: string; tone?: "neutral" | "good" | "bad" }) {
  const color = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : "text-neutral-900";
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
      <div className="text-xs font-semibold text-neutral-500">{title}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-neutral-500">{sub}</div>}
    </div>
  );
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

/** The range (and, for officers, branch) picker. */
export function QcRangeForm({ action, from, to, branches, branchId }: { action: string; from: string; to: string; branches?: { id: string; name: string }[]; branchId?: string }) {
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-neutral-200/70">
      <label className="space-y-1 text-xs font-semibold text-neutral-700">
        <div>From</div>
        <input type="month" name="from" defaultValue={from} className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm" />
      </label>
      <label className="space-y-1 text-xs font-semibold text-neutral-700">
        <div>To</div>
        <input type="month" name="to" defaultValue={to} className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm" />
      </label>
      {branches && (
        <label className="space-y-1 text-xs font-semibold text-neutral-700">
          <div>Branch</div>
          <select name="branch" defaultValue={branchId ?? ""} className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm">
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white">Show</button>
    </form>
  );
}

/** Quality KPIs of the quality control department. */
export function QcAnalysisView({ a, showBranches }: { a: QcAnalysis; showBranches?: boolean }) {
  const ftpr = a.checks ? a.firstPass / a.checks : 0;
  const comebacks = a.byPurpose.find((r) => r.key === "comeback")?.checks ?? 0;
  const maxMonth = Math.max(1, ...a.months.map((m) => m.checks));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile title="Vehicles checked" value={String(a.checks)} sub={`${a.tests} tests in all`} />
        <Tile title="First-time pass rate" value={pct(a.firstPass, a.checks)} sub={`${a.firstPass} passed at the first test`} tone={!a.checks ? "neutral" : ftpr >= 0.9 ? "good" : "bad"} />
        <Tile title="Fail rate (per test)" value={pct(a.failedTests, a.tests)} sub={`${a.failedTests} failed tests`} tone={a.failedTests ? "bad" : "neutral"} />
        <Tile title="Tests per passed vehicle" value={a.avgAttemptsToPass != null ? a.avgAttemptsToPass.toFixed(2) : "—"} sub="1.00 = all right first time" />
        <Tile title="Waiting for retest" value={String(a.waiting)} sub={`${a.waitingOver24h} for more than 24 h`} tone={a.waiting ? "bad" : "good"} />
        <Tile title="Fixed after a fail" value={String(a.recovered)} sub="failed, then passed" />
        <Tile title="Rework time (median)" value={a.medianReworkHours != null ? (a.medianReworkHours >= 24 ? `${(a.medianReworkHours / 24).toFixed(1)} d` : `${a.medianReworkHours.toFixed(1)} h`) : "—"} sub="from the fail to the pass" />
        <Tile title="Comebacks" value={String(comebacks)} sub={`${pct(comebacks, a.checks)} of the vehicles checked`} tone={comebacks ? "bad" : "neutral"} />
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-bold text-neutral-900">By month</div>
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
          {a.months.map((m) => (
            <div key={m.month} className="flex min-w-10 flex-1 flex-col items-center gap-1">
              <div className="text-[11px] font-semibold text-neutral-700 tabular-nums">{m.checks ? pct(m.firstPass, m.checks) : ""}</div>
              <div className="flex w-full max-w-12 flex-col-reverse overflow-hidden rounded-t" style={{ height: `${(m.checks / maxMonth) * 120}px` }}>
                <div className="bg-emerald-500" style={{ height: `${m.checks ? (m.firstPass / m.checks) * 100 : 0}%` }} />
                <div className="flex-1 bg-red-400" />
              </div>
              <div className="text-[11px] text-neutral-500">{monthName(m.month)}</div>
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
      {!a.checks && <p className="rounded-xl bg-white p-6 text-center text-sm text-neutral-500 shadow-sm ring-1 ring-neutral-200/70">No QC in these months.</p>}
    </div>
  );
}
