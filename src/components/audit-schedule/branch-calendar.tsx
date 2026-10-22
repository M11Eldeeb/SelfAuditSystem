"use client";

import { useMemo } from "react";
import { MONTHS, Month, fmt, type Marks } from "@/app/admin/(audits)/internal-audit/schedule/schedule-board";
import { auditDays } from "@/lib/ia-schedule-days";

export type BranchAudit = { slot: number; date: string | null; days: number; done: boolean };

/** Read only: the branch's internal audits of the year, and the year calendar with holidays and weekends. */
export function BranchCalendar({ year, today, audits, holidays }: { year: number; today: string; audits: BranchAudit[]; holidays: { day: string; name: string }[] }) {
  const holidaySet = useMemo(() => new Set(holidays.map((h) => h.day)), [holidays]);
  const marks: Marks = useMemo(() => {
    const holiday = new Map<string, string>();
    for (const h of holidays) holiday.set(h.day, holiday.has(h.day) ? `${holiday.get(h.day)}, ${h.name}` : h.name);
    const days = new Map<string, string[]>();
    for (const a of audits) if (a.date) for (const d of auditDays(a.date, a.days, holidaySet)) days.set(d, [`Audit ${a.slot}`]);
    return { holiday, audits: days };
  }, [audits, holidays, holidaySet]);

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-900">Internal audits of your branch in {year}</h2>
        {audits.length === 0 ? (
          <p className="rounded-xl bg-white p-4 text-sm text-neutral-500 shadow-sm ring-1 ring-neutral-200/70">No internal audits planned for {year} yet.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {audits.map((a) => {
              const range = a.date ? auditDays(a.date, a.days, holidaySet) : [];
              const end = range[range.length - 1];
              const status = a.done ? "Done" : !a.date ? "Date to be set" : end < today ? "Passed" : a.date.slice(0, 7) === today.slice(0, 7) ? "This month" : "Planned";
              const tone = status === "This month" ? "bg-amber-50 text-amber-800" : status === "Done" || status === "Passed" ? "bg-neutral-100 text-neutral-600" : "bg-blue-50 text-blue-800";
              return (
                <li key={a.slot} className="flex items-center justify-between gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-neutral-200/70">
                  <div>
                    <div className="text-xs font-semibold tracking-wide text-neutral-400 uppercase">Audit {a.slot}</div>
                    <div className="font-medium text-neutral-900">
                      {a.date ? (
                        <>
                          {fmt(a.date)}
                          {end !== a.date && ` – ${fmt(end)}`}
                        </>
                      ) : (
                        "—"
                      )}
                    </div>
                    {a.date && <div className="text-xs text-neutral-500">{range.length} working day{range.length === 1 ? "" : "s"}</div>}
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>{status}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-neutral-900">{year} calendar</h2>
          <div className="flex flex-wrap gap-3 text-xs text-neutral-600">
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded bg-brand" /> Audit
            </span>
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded bg-red-100 ring-1 ring-red-200" /> Holiday
            </span>
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded bg-neutral-200" /> Friday / Saturday
            </span>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {MONTHS.map((_, m) => (
            <Month key={m} year={year} month={m} marks={marks} today={today} />
          ))}
        </div>
      </section>
    </div>
  );
}
