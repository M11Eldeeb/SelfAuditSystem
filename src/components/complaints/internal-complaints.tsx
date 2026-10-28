"use client";

import { useMemo, useState } from "react";
import type { InternalData } from "@/app/actions/complaints";
import { monthShort } from "@/components/dashboard/charts";
import { Panel, fmtInt } from "@/components/dashboard/ui";
import { Change, Heatmap, Kpi, MonthColumns, PERIODS, Segmented, count, monthsBetween, periodRange, type PeriodKey } from "./shared";

/** Internal complaints (Google Sheet): how many, per branch, per date. */
export function InternalComplaints({ data }: { data: InternalData }) {
  const [period, setPeriod] = useState<PeriodKey>("6m");
  const [branch, setBranch] = useState("all");
  const dated = useMemo(() => data.rows.filter((r) => r.date).sort((a, b) => a.date!.localeCompare(b.date!)), [data.rows]);
  const range = periodRange(period, data.today, dated[0]?.date?.slice(0, 7) ?? null);
  const months = monthsBetween(range.from, range.to);
  const [month, setMonth] = useState(data.today.slice(0, 7));
  const branches = useMemo(() => [...new Set(data.rows.map((r) => r.branch))].sort(), [data.rows]);

  if (data.error) return <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{data.error}</p>;
  if (!data.rows.length) return <p className="rounded-2xl bg-white px-5 py-10 text-center text-[14px] text-[#6e6e73] ring-1 ring-black/[0.05]">The internal complaints sheet has no rows yet.</p>;

  const pick = (b: string) => branch === "all" || b === branch;
  const inM = (d: string | null, from: string | null, to: string | null) => !!d && !!from && !!to && d.slice(0, 7) >= from && d.slice(0, 7) <= to;
  const list = dated.filter((r) => pick(r.branch) && inM(r.date, range.from, range.to));
  const prev = range.prevFrom ? dated.filter((r) => pick(r.branch) && inM(r.date, range.prevFrom, range.prevTo)) : null;
  const thisMonth = dated.filter((r) => pick(r.branch) && r.date!.startsWith(data.today.slice(0, 7))).length;
  const perBranch = [...count(list, (r) => r.branch).entries()].sort((a, b) => b[1] - a[1]);
  const perMonthAvg = list.length / Math.max(1, months.length);
  const undated = data.rows.filter((r) => !r.date && pick(r.branch)).length;

  // Daily view of one month.
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dayList = Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  const dayCounts = count(
    dated.filter((r) => pick(r.branch) && r.date!.startsWith(month)),
    (r) => r.date!
  );
  const dayMax = Math.max(...dayList.map((d) => dayCounts.get(d) ?? 0), 1);
  const cats = data.columns.category ? [...count(list, (r) => r.category ?? "Not set").entries()].sort((a, b) => b[1] - a[1]).slice(0, 12) : [];
  const monthOptions = [...new Set(dated.map((r) => r.date!.slice(0, 7)))].sort().reverse();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Period" value={period} options={PERIODS} onChange={setPeriod} />
        {data.scope === "all" && (
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-[13px]" aria-label="Branch">
            <option value="all">All branches</option>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Complaints" value={fmtInt(list.length)} sub={<Change now={list.length} before={prev?.length ?? null} />} />
        <Kpi label="This month" value={fmtInt(thisMonth)} sub={monthShort(data.today.slice(0, 7))} />
        <Kpi label="Per month (avg.)" value={perMonthAvg.toFixed(1)} sub={`${months.length} months`} />
        <Kpi label="Most complaints" value={perBranch[0]?.[0] ?? "—"} sub={perBranch[0] ? `${fmtInt(perBranch[0][1])} · ${((perBranch[0][1] / Math.max(1, list.length)) * 100).toFixed(0)}% of all` : undefined} />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Panel className="lg:col-span-3" title="Complaints per month" subtitle="By complaint date">
          <MonthColumns months={months} series={[{ key: "n", label: "Internal complaints", color: "#c4121a" }]} values={(mm) => list.filter((r) => r.date!.startsWith(mm)).length} />
        </Panel>
        <Panel className="lg:col-span-2" title="Per branch" subtitle={`${monthShort(range.from)} – ${monthShort(range.to)}`}>
          <div className="space-y-2">
            {perBranch.map(([b, n]) => (
              <div key={b} className="space-y-1">
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="font-semibold text-[#1d1d1f]">{b}</span>
                  <span className="tabular-nums text-[#6e6e73]">
                    {fmtInt(n)} · {((n / Math.max(1, list.length)) * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-neutral-900/[0.05]">
                  <div className="h-full rounded-full bg-[#c4121a]" style={{ width: `${(n / (perBranch[0]?.[1] ?? 1)) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {data.scope === "all" && branch === "all" && (
        <Panel title="Branch × month" subtitle="Darker = more complaints">
          <Heatmap rows={perBranch.map(([b]) => b)} cols={months} colLabel={monthShort} value={(b, mm) => list.filter((r) => r.branch === b && r.date!.startsWith(mm)).length} />
        </Panel>
      )}

      <Panel
        title="Per day"
        subtitle="Complaints logged each day of the month"
        action={
          <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-[13px]" aria-label="Month">
            {(monthOptions.includes(month) ? monthOptions : [month, ...monthOptions]).map((mm) => (
              <option key={mm} value={mm}>
                {monthShort(mm)}
              </option>
            ))}
          </select>
        }
      >
        <div className="overflow-x-auto">
          <div className="grid h-40 min-w-[620px] gap-1" style={{ gridTemplateColumns: `repeat(${daysInMonth}, minmax(0, 1fr))` }}>
            {dayList.map((d) => {
              const n = dayCounts.get(d) ?? 0;
              const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
              return (
                <div key={d} className="flex h-full flex-col items-center justify-end gap-1" title={`${d}: ${n}`}>
                  <span className="text-[10px] font-semibold tabular-nums text-[#3a3a3c]">{n || ""}</span>
                  <div className="w-full max-w-5 rounded-sm bg-[#c4121a]" style={{ height: `${(n / dayMax) * 100}%`, minHeight: n ? 2 : 0 }} />
                  <span className={`text-[10px] ${dow === 5 || dow === 6 ? "text-[#c4121a]" : "text-[#8e8e93]"}`}>{Number(d.slice(8))}</span>
                </div>
              );
            })}
          </div>
        </div>
        <p className="mt-2 text-[12px] text-[#6e6e73]">Day numbers in red are Friday and Saturday.</p>
      </Panel>

      {cats.length > 1 && (
        <Panel title={`By ${data.columns.category}`} subtitle="Top 12 in the period">
          <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {cats.map(([c, n]) => (
              <div key={c} className="flex items-baseline justify-between text-[13px]">
                <span className="text-[#1d1d1f]">{c}</span>
                <span className="font-semibold tabular-nums">{fmtInt(n)}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <p className="text-[12px] text-[#6e6e73]">
        From the internal complaints Google Sheet (refreshed every 10 minutes) · date column: {data.columns.date ?? "not found"} · branch column: {data.columns.branch ?? "not found"}
        {undated ? ` · ${fmtInt(undated)} row${undated === 1 ? "" : "s"} without a readable date left out` : ""}.
      </p>
    </div>
  );
}
