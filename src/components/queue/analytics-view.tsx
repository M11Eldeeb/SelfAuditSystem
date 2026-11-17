import Link from "next/link";
import { dailyStats, hourlyCounts, weekdayCounts } from "@/lib/queue/core";
import type { StatRow } from "@/lib/queue/pages";

const RANGES = [7, 14, 30, 90];
const fmt = (n: number | null) => (n == null ? "—" : n < 10 ? n.toFixed(1) : Math.round(n).toString());

function Bars({ rows, labelWidth = "w-12" }: { rows: { label: string; value: number }[]; labelWidth?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2 text-xs">
          <span className={`${labelWidth} shrink-0 text-neutral-500 tabular-nums`}>{r.label}</span>
          <span className="h-4 flex-1 overflow-hidden rounded bg-neutral-100">
            <span className="block h-full rounded bg-brand/80" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="w-8 shrink-0 text-end font-medium text-neutral-800 tabular-nums">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
      <h2 className="mb-3 text-sm font-semibold text-neutral-900">{title}</h2>
      {children}
    </section>
  );
}

/** Queue analytics for a period: totals, waiting and service times by day, busy hours and days, and by advisor. */
export function AnalyticsView({ rows, days, basePath }: { rows: StatRow[]; days: number; basePath: string }) {
  const daily = dailyStats(rows, days);
  const hours = hourlyCounts(rows).filter((h) => h.hour >= 7 && h.hour <= 23);
  const weekdays = weekdayCounts(rows, "en");
  const served = rows.filter((r) => r.served_at);
  const done = rows.filter((r) => r.status === "completed" && r.served_at && r.closed_at);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const avgWait = avg(served.map((r) => (+new Date(r.served_at!) - +new Date(r.queue_entry_at)) / 60000));
  const avgService = avg(done.map((r) => (+new Date(r.closed_at!) - +new Date(r.served_at!)) / 60000));
  const noShows = rows.filter((r) => r.status === "no_show").length;
  const byAdvisor = new Map<string, { served: number; minutes: number[] }>();
  for (const r of rows) {
    if (!r.advisor_name || !r.served_at) continue;
    const x = byAdvisor.get(r.advisor_name) ?? { served: 0, minutes: [] };
    x.served++;
    if (r.status === "completed" && r.closed_at) x.minutes.push((+new Date(r.closed_at) - +new Date(r.served_at)) / 60000);
    byAdvisor.set(r.advisor_name, x);
  }
  const advisors = [...byAdvisor.entries()].sort((a, b) => b[1].served - a[1].served);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-neutral-200/70 w-fit">
        {RANGES.map((d) => (
          <Link key={d} href={`${basePath}?days=${d}`} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${d === days ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>
            {d} days
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Customers", value: rows.length.toString() },
          { label: "Avg wait (min)", value: fmt(avgWait) },
          { label: "Avg service (min)", value: fmt(avgService) },
          { label: "No-shows", value: noShows.toString() },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
            <div className="text-xs text-neutral-500">{k.label}</div>
            <div className="text-2xl font-bold text-neutral-900 tabular-nums">{k.value}</div>
          </div>
        ))}
      </div>

      <Card title="By day">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="text-xs text-neutral-500">
              <tr className="border-b border-neutral-100 text-start">
                <th className="py-2 text-start font-medium">Date</th>
                <th className="py-2 text-end font-medium">Customers</th>
                <th className="py-2 text-end font-medium">Completed</th>
                <th className="py-2 text-end font-medium">Avg wait (min)</th>
                <th className="py-2 text-end font-medium">Avg service (min)</th>
              </tr>
            </thead>
            <tbody>
              {[...daily].reverse().map((d) => (
                <tr key={d.date} className="border-b border-neutral-50 tabular-nums">
                  <td className="py-1.5 text-neutral-700">{d.date}</td>
                  <td className="py-1.5 text-end">{d.tickets}</td>
                  <td className="py-1.5 text-end">{d.served}</td>
                  <td className="py-1.5 text-end">{fmt(d.avgWaitMin)}</td>
                  <td className="py-1.5 text-end">{fmt(d.avgServiceMin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Busy hours (customers joining)">
          <Bars rows={hours.map((h) => ({ label: `${String(h.hour).padStart(2, "0")}:00`, value: h.count }))} />
        </Card>
        <Card title="Busy days">
          <Bars rows={weekdays.map((w) => ({ label: w.day, value: w.count }))} />
        </Card>
      </div>

      <Card title="By advisor">
        {advisors.length === 0 ? (
          <p className="text-sm text-neutral-400">No customers served in this period.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-neutral-500">
              <tr className="border-b border-neutral-100">
                <th className="py-2 text-start font-medium">Advisor</th>
                <th className="py-2 text-end font-medium">Served</th>
                <th className="py-2 text-end font-medium">Avg service (min)</th>
              </tr>
            </thead>
            <tbody>
              {advisors.map(([name, x]) => (
                <tr key={name} className="border-b border-neutral-50 tabular-nums">
                  <td className="py-1.5 text-neutral-800">{name}</td>
                  <td className="py-1.5 text-end">{x.served}</td>
                  <td className="py-1.5 text-end">{fmt(avg(x.minutes))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

export const daysParam = (v: string | string[] | undefined) => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return RANGES.includes(n) ? n : 14;
};
