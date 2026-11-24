import Link from "next/link";
import { dailyStats, hourlyCounts, saudiDate, startOfSaudiDay, weekdayCounts } from "@/lib/queue/core";
import type { ApptRow, StatRow } from "@/lib/queue/pages";

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

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const minutesBetween = (a: string, b: string) => (+new Date(a) - +new Date(b)) / 60000;
/** How early / late an appointment customer joined the queue: within 15 minutes of the booked time is on time. */
const ON_TIME_MIN = 15;

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-2xl font-bold text-neutral-900 tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-neutral-400">{hint}</div>}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead className="text-xs text-neutral-500">
          <tr className="border-b border-neutral-100">
            {head.map((h, i) => (
              <th key={h} className={`py-2 font-medium ${i ? "text-end" : "text-start"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r[0])} className="border-b border-neutral-50 tabular-nums">
              {r.map((c, i) => (
                <td key={i} className={`py-1.5 ${i ? "text-end" : "text-neutral-800"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The appointment KPIs of the period: show rate and no-shows (days already over - today's customers may still come),
 * on-time arrival against the booked time, the wait of appointment customers against walk-ins, by branch, by the advisor
 * named in the sheet, by day (by week over 30 days) and the DMS sheet against added by hand.
 */
function AppointmentKpis({ appts, rows, days, branchNames }: { appts: ApptRow[]; rows: StatRow[]; days: number; branchNames?: Record<string, string> }) {
  const today = saudiDate(startOfSaudiDay(0));
  const ticketOf = new Map<string, StatRow>();
  for (const r of rows) if (r.appointment_id && !ticketOf.has(r.appointment_id)) ticketOf.set(r.appointment_id, r);
  const came = (a: ApptRow) => ticketOf.has(a.id);
  const past = appts.filter((a) => a.appt_date < today);
  const todays = appts.filter((a) => a.appt_date === today);
  const noShows = past.filter((a) => !came(a)).length;

  // On time: the queue entry against the booked time.
  let early = 0;
  let onTime = 0;
  const late: number[] = [];
  for (const a of appts) {
    const t = ticketOf.get(a.id);
    if (!t) continue;
    const at = t.appointment_at ?? (a.appt_time ? new Date(`${a.appt_date}T${a.appt_time.slice(0, 5)}:00+03:00`).toISOString() : null);
    if (!at) continue;
    const d = minutesBetween(t.queue_entry_at, at);
    if (d < -ON_TIME_MIN) early++;
    else if (d <= ON_TIME_MIN) onTime++;
    else late.push(d);
  }
  const timed = early + onTime + late.length;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null);

  // Wait to be called: appointment customers against walk-ins.
  const waitOf = (list: StatRow[]) => mean(list.filter((r) => r.served_at).map((r) => minutesBetween(r.served_at!, r.queue_entry_at)));
  const apptWait = waitOf(rows.filter((r) => r.appointment_id || r.service_mode === "appointment"));
  const walkWait = waitOf(rows.filter((r) => r.service_mode === "walk_in" && !r.appointment_id));

  /** Booked / came / no-shows / show rate of a group (no-shows and the show rate over the days already over). */
  const line = (label: string, list: ApptRow[]): (string | number)[] => {
    const p = list.filter((a) => a.appt_date < today);
    return [label, list.length, list.filter(came).length, p.filter((a) => !came(a)).length, pct(p.filter(came).length, p.length)];
  };
  const group = (key: (a: ApptRow) => string) => {
    const m = new Map<string, ApptRow[]>();
    for (const a of appts) m.set(key(a), [...(m.get(key(a)) ?? []), a]);
    return [...m.entries()].sort((x, y) => y[1].length - x[1].length);
  };
  const byBranch = group((a) => branchNames?.[a.branch_id] ?? "—");
  const byAdvisor = group((a) => a.service_reception?.trim() || "Not named");
  // By day, or by week (from Saturday) over 30 days.
  const weekly = days > 30;
  const periodOf = (date: string) => {
    if (!weekly) return date;
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 1) % 7));
    return `Week of ${d.toISOString().slice(0, 10)}`;
  };
  const byPeriod = group((a) => periodOf(a.appt_date)).sort((x, y) => (x[0] < y[0] ? 1 : -1));
  const sheet = appts.filter((a) => a.source !== "manual");
  const manual = appts.filter((a) => a.source === "manual");
  const HEAD = ["Booked", "Came", "No-shows", "Show rate"];

  return (
    <section className="space-y-3">
      <h2 className="pt-2 text-lg font-bold tracking-tight text-neutral-900">Appointments</h2>
      {appts.length === 0 ? (
        <p className="rounded-2xl bg-white p-4 text-sm text-neutral-500 shadow-sm ring-1 ring-neutral-200/70">No appointments in this period.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Booked" value={String(appts.length)} hint={`${todays.length} today`} />
            <Kpi label="Came" value={String(appts.filter(came).length)} hint={`${todays.filter(came).length} of ${todays.length} today so far`} />
            <Kpi label="Show rate" value={pct(past.filter(came).length, past.length)} hint="days already over" />
            <Kpi label="No-shows" value={String(noShows)} hint="days already over" />
            <Kpi label="On time" value={pct(onTime, timed)} hint={`within ${ON_TIME_MIN} min of the booked time`} />
            <Kpi label="Avg wait (min)" value={fmt(apptWait)} hint={`walk-ins ${fmt(walkWait)}`} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Arrival against the booked time">
              <Bars
                labelWidth="w-20"
                rows={[
                  { label: "Early", value: early },
                  { label: "On time", value: onTime },
                  { label: "Late", value: late.length },
                ]}
              />
              <p className="mt-2 text-xs text-neutral-500">
                Early or late: more than {ON_TIME_MIN} minutes before / after the booked time.{late.length ? ` Late customers came ${fmt(mean(late))} min late on average.` : ""}
              </p>
            </Card>
            <Card title="Wait to be called (min)">
              <Bars
                labelWidth="w-24"
                rows={[
                  { label: "Appointment", value: Math.round(apptWait ?? 0) },
                  { label: "Walk-in", value: Math.round(walkWait ?? 0) },
                ]}
              />
              <p className="mt-2 text-xs text-neutral-500">From joining the queue to being called by an advisor.</p>
            </Card>
          </div>

          {byBranch.length > 1 && (
            <Card title="By branch">
              <Table head={["Branch", ...HEAD]} rows={byBranch.map(([k, l]) => line(k, l))} />
            </Card>
          )}
          <Card title="By advisor (as named in the appointments sheet)">
            <Table head={["Advisor", ...HEAD]} rows={byAdvisor.map(([k, l]) => line(k, l))} />
          </Card>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title={weekly ? "By week" : "By day"}>
              <Table head={[weekly ? "Week" : "Date", ...HEAD]} rows={byPeriod.map(([k, l]) => line(k, l))} />
            </Card>
            <Card title="Where the appointment came from">
              <Table head={["Source", ...HEAD]} rows={[line("DMS sheet", sheet), line("Added by hand", manual)].filter((r) => Number(r[1]) > 0)} />
            </Card>
          </div>
        </>
      )}
    </section>
  );
}

/** Queue analytics for a period: totals, waiting and service times by day, busy hours and days, by advisor, and the appointments. */
export function AnalyticsView({ rows, days, basePath, appts, branchNames }: { rows: StatRow[]; days: number; basePath: string; appts?: ApptRow[]; branchNames?: Record<string, string> }) {
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

      {appts && <AppointmentKpis appts={appts} rows={rows} days={days} branchNames={branchNames} />}
    </div>
  );
}

export const daysParam = (v: string | string[] | undefined) => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return RANGES.includes(n) ? n : 14;
};
