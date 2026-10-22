"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addHoliday, removeHoliday, setAuditDate, setBranchAuditCount } from "./actions";
import { auditDays, auditDaysProblem, isLastWeek, isWeekend, weekdayOf } from "@/lib/ia-schedule-days";

export type ScheduleData = {
  year: number;
  today: string;
  branches: { id: string; name: string; code: string }[];
  slots: { id: string; branchId: string; slot: number; date: string | null; days: number; audit: { id: string; name: string; finalized: boolean } | null }[];
  holidays: { id: string; day: string; name: string; official: boolean }[];
};

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
export const fmt = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const inputCls = "rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-brand focus:outline-none";

/** The cells of one month (Sunday first), null for the blanks. */
function monthCells(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return [...Array<null>(first).fill(null), ...Array.from({ length: days }, (_, i) => iso(year, month, i + 1))];
}

export type Marks = { holiday: Map<string, string>; audits: Map<string, string[]> };

/** One month as a grid. Fridays / Saturdays grey, holidays red, last week of the month struck out, audit days in the brand colour. */
export function Month({ year, month, marks, selected, onPick, today }: { year: number; month: number; marks: Marks; selected?: string | null; onPick?: (d: string) => void; today: string }) {
  return (
    <div>
      <div className="mb-1 text-center text-xs font-semibold text-neutral-700">{MONTHS[month]}</div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]">
        {WEEK.map((w, i) => (
          <div key={w} className={`py-0.5 font-medium ${i >= 5 ? "text-neutral-400" : "text-neutral-500"}`}>
            {w.slice(0, 2)}
          </div>
        ))}
        {monthCells(year, month).map((d, i) => {
          if (!d) return <div key={`b${i}`} />;
          const holiday = marks.holiday.get(d);
          const audits = marks.audits.get(d);
          const lastWeek = isLastWeek(d);
          const cls = audits
            ? "bg-brand text-white font-semibold"
            : holiday
              ? "bg-red-100 text-red-800"
              : isWeekend(d)
                ? "bg-neutral-200/80 text-neutral-500"
                : lastWeek
                  ? "bg-[repeating-linear-gradient(135deg,#f5f5f5_0,#f5f5f5_3px,#e5e5e5_3px,#e5e5e5_5px)] text-neutral-400"
                  : "text-neutral-800";
          const title = [fmt(d), holiday, isWeekend(d) ? "Weekend" : null, lastWeek ? "Last week of the month - no audits" : null, audits ? `Audit: ${audits.join(", ")}` : null].filter(Boolean).join(" · ");
          const ring = d === selected ? "ring-2 ring-offset-1 ring-amber-500" : d === today ? "ring-1 ring-neutral-500" : "";
          return onPick ? (
            <button key={d} type="button" title={title} disabled={lastWeek} onClick={() => onPick(d)} className={`rounded py-1 enabled:hover:ring-2 enabled:hover:ring-brand/50 disabled:cursor-not-allowed ${cls} ${ring}`}>
              {Number(d.slice(8))}
            </button>
          ) : (
            <div key={d} title={title} className={`rounded py-0.5 ${cls} ${ring}`}>
              {Number(d.slice(8))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A planned audit's date: a button opening a month calendar to pick from. */
function DatePick({ slot, year, marks, today, onSaved }: { slot: ScheduleData["slots"][number]; year: number; marks: Marks; today: string; onSaved: (e?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => (slot.date ? Number(slot.date.slice(5, 7)) - 1 : today.startsWith(String(year)) ? Number(today.slice(5, 7)) - 1 : 0));
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState(slot.days);
  const [problem, setProblem] = useState<string | null>(null);
  const holidaySet = useMemo(() => new Set(marks.holiday.keys()), [marks.holiday]);

  async function pick(d: string | null, length = days) {
    setProblem(null);
    if (d) {
      const issue = auditDaysProblem(auditDays(d, length, holidaySet));
      if (issue) return setProblem(issue);
      const why = [marks.holiday.get(d), isWeekend(d) ? (weekdayOf(d) === 5 ? "a Friday" : "a Saturday") : null].filter(Boolean).join(" and ");
      if (why && !window.confirm(`${fmt(d)} is ${why}. Start the audit on this day anyway?`)) return;
    }
    setBusy(true);
    const r = await setAuditDate(slot.id, d, length);
    setBusy(false);
    if (r.error) return setProblem(r.error);
    setOpen(false);
    onSaved();
  }

  const range = slot.date ? auditDays(slot.date, slot.days, holidaySet) : [];
  const end = range[range.length - 1];

  const status = slot.audit
    ? { label: slot.audit.finalized ? "Done" : "List created", cls: "bg-emerald-50 text-emerald-800" }
    : !slot.date
      ? { label: "No date", cls: "bg-amber-50 text-amber-800" }
      : end < today
        ? { label: "Overdue", cls: "bg-red-50 text-red-700" }
        : { label: "Planned", cls: "bg-blue-50 text-blue-800" };

  return (
    <div className="relative space-y-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        className={`w-full rounded-lg border px-2 py-1.5 text-left text-sm shadow-sm ${slot.date ? "border-neutral-300 bg-white" : "border-dashed border-amber-400 bg-amber-50/40 text-amber-800"} ${slot.date && (marks.holiday.has(slot.date) || isWeekend(slot.date)) ? "text-red-700" : ""}`}
      >
        <span className="block text-[10px] font-semibold tracking-wide text-neutral-400 uppercase">Audit {slot.slot}</span>
        {slot.date ? (
          <>
            {fmt(slot.date)}
            {end !== slot.date && <span className="text-neutral-500"> – {fmt(end)}</span>}
            <span className="block text-[11px] text-neutral-400">
              {slot.days} day{slot.days === 1 ? "" : "s"}
            </span>
          </>
        ) : (
          "Pick date"
        )}
      </button>
      <div className="flex flex-wrap items-center gap-1">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.cls}`}>{status.label}</span>
        {slot.audit ? (
          <Link href={slot.audit.finalized ? `/admin/internal-audit/${slot.audit.id}/report` : `/admin/internal-audit/${slot.audit.id}?claim=0`} className="text-[11px] text-brand hover:underline">
            Open
          </Link>
        ) : (
          slot.date && (
            <Link href={`/admin/internal-audit?branch=${slot.branchId}&date=${slot.date}`} className="text-[11px] text-brand hover:underline">
              Create list
            </Link>
          )
        )}
      </div>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setOpen(false)}>
        <div className="w-72 space-y-2 rounded-xl bg-white p-4 shadow-xl ring-1 ring-neutral-200" onClick={(e) => e.stopPropagation()}>
          <div className="text-sm font-semibold text-neutral-900">Audit {slot.slot} - first day</div>
          <label className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-600">
            Lasts
            <select
              value={days}
              onChange={(e) => {
                const n = Number(e.target.value);
                setDays(n);
                if (slot.date) void pick(slot.date, n);
              }}
              className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            working day{days === 1 ? "" : "s"} (Fri, Sat and holidays skipped)
          </label>
          <div className="flex items-center justify-between">
            <button type="button" disabled={month === 0} onClick={() => setMonth((m) => m - 1)} className="rounded px-2 text-lg text-neutral-600 disabled:opacity-30">
              ‹
            </button>
            <span className="text-xs text-neutral-500">{year}</span>
            <button type="button" disabled={month === 11} onClick={() => setMonth((m) => m + 1)} className="rounded px-2 text-lg text-neutral-600 disabled:opacity-30">
              ›
            </button>
          </div>
          <Month year={year} month={month} marks={marks} selected={slot.date} onPick={(d) => void pick(d)} today={today} />
          {problem && <p className="rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-700">{problem}</p>}
          <div className="flex justify-between text-xs">
            {slot.date && !slot.audit ? (
              <button type="button" onClick={() => void pick(null)} className="text-red-600 hover:underline">
                Clear date
              </button>
            ) : (
              <span />
            )}
            <button type="button" onClick={() => setOpen(false)} className="text-neutral-500 hover:underline">
              Close
            </button>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}

export function ScheduleBoard({ data }: { data: ScheduleData }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [hFrom, setHFrom] = useState("");
  const [hTo, setHTo] = useState("");
  const [hName, setHName] = useState("");

  const done = (e?: string) => {
    setError(e ?? null);
    router.refresh();
  };

  const codeOf = useMemo(() => new Map(data.branches.map((b) => [b.id, b.code || b.name])), [data.branches]);
  const marks: Marks = useMemo(() => {
    const holiday = new Map<string, string>();
    for (const h of data.holidays) holiday.set(h.day, holiday.has(h.day) ? `${holiday.get(h.day)}, ${h.name}` : h.name);
    const audits = new Map<string, string[]>();
    const holidaySet = new Set(holiday.keys());
    for (const s of data.slots) if (s.date) for (const d of auditDays(s.date, s.days, holidaySet)) audits.set(d, [...(audits.get(d) ?? []), codeOf.get(s.branchId) ?? ""]);
    return { holiday, audits };
  }, [data.holidays, data.slots, codeOf]);

  // Holidays grouped by name: one row per holiday with its first and last day.
  const holidayGroups = useMemo(() => {
    const g = new Map<string, { name: string; from: string; to: string; official: boolean; days: number }>();
    for (const h of data.holidays) {
      const cur = g.get(h.name);
      if (!cur) g.set(h.name, { name: h.name, from: h.day, to: h.day, official: h.official, days: 1 });
      else Object.assign(cur, { to: h.day > cur.to ? h.day : cur.to, from: h.day < cur.from ? h.day : cur.from, days: cur.days + 1 });
    }
    return [...g.values()].sort((a, b) => a.from.localeCompare(b.from));
  }, [data.holidays]);

  const slotsOf = (branchId: string) => data.slots.filter((s) => s.branchId === branchId).sort((a, b) => a.slot - b.slot);
  const planned = data.slots.length;
  const dated = data.slots.filter((s) => s.date).length;
  const created = data.slots.filter((s) => s.audit).length;

  async function setCount(branchId: string, n: number) {
    setBusy(branchId);
    const r = await setBranchAuditCount(data.year, branchId, n);
    setBusy(null);
    done(r.error);
  }

  async function saveHoliday() {
    setBusy("holiday");
    const r = await addHoliday(hFrom, hTo, hName);
    setBusy(null);
    if (!r.error) {
      setHFrom("");
      setHTo("");
      setHName("");
    }
    done(r.error);
  }

  async function dropHoliday(name: string) {
    if (!window.confirm(`Remove "${name}" from ${data.year}?`)) return;
    setBusy("holiday");
    const r = await removeHoliday(name, data.year);
    setBusy(null);
    done(r.error);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="rounded-full bg-white px-3 py-1 ring-1 ring-neutral-200">
          <b>{planned}</b> audits planned
        </span>
        <span className={`rounded-full px-3 py-1 ring-1 ${dated < planned ? "bg-amber-50 ring-amber-200" : "bg-white ring-neutral-200"}`}>
          <b>{dated}</b> with a date
        </span>
        <span className="rounded-full bg-white px-3 py-1 ring-1 ring-neutral-200">
          <b>{created}</b> audit lists created
        </span>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <section className="rounded-xl border border-neutral-200/70 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              <tr>
                <th className="px-4 py-2">Branch</th>
                <th className="px-4 py-2">Audits in {data.year}</th>
                <th className="px-4 py-2" colSpan={4}>
                  Dates
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {data.branches.map((b) => {
                const slots = slotsOf(b.id);
                return (
                  <tr key={b.id} className="align-top">
                    <td className="px-4 py-3 font-medium whitespace-nowrap text-neutral-900">
                      {b.name}
                      <span className="ml-1 text-xs text-neutral-400">{b.code}</span>
                    </td>
                    <td className="px-4 py-3">
                      <select value={slots.length} disabled={busy === b.id} onChange={(e) => void setCount(b.id, Number(e.target.value))} className={inputCls}>
                        {[0, 1, 2, 3, 4].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </td>
                    {[1, 2, 3, 4].map((n) => {
                      const s = slots.find((x) => x.slot === n);
                      return (
                        <td key={n} className="min-w-36 px-2 py-3">
                          {s ? <DatePick slot={s} year={data.year} marks={marks} today={data.today} onSaved={done} /> : null}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-neutral-900">{data.year} calendar</h2>
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
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded bg-[repeating-linear-gradient(135deg,#f5f5f5_0,#f5f5f5_3px,#e5e5e5_3px,#e5e5e5_5px)] ring-1 ring-neutral-200" /> Last week of the month - no audits
            </span>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {MONTHS.map((_, m) => (
            <Month key={m} year={data.year} month={m} marks={marks} today={data.today} />
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-neutral-900">Holidays in {data.year}</h2>
        <p className="text-xs text-neutral-500">Eid dates follow the moon sighting - correct them when they are announced (remove and add again).</p>
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-100 text-sm">
          {holidayGroups.map((h) => (
            <li key={h.name} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 font-medium text-neutral-900">{h.name}</span>
              <span className="text-neutral-600">
                {fmt(h.from)}
                {h.to !== h.from && ` – ${fmt(h.to)}`}
              </span>
              <span className="text-xs text-neutral-400">{h.official ? "official" : "added"}</span>
              <button type="button" disabled={busy === "holiday"} onClick={() => void dropHoliday(h.name)} className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50">
                Remove
              </button>
            </li>
          ))}
          {holidayGroups.length === 0 && <li className="px-3 py-3 text-neutral-500">No holidays for {data.year} yet - add them below.</li>}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="block text-xs text-neutral-600">From</span>
            <input type="date" min={`${data.year}-01-01`} max={`${data.year}-12-31`} value={hFrom} onChange={(e) => setHFrom(e.target.value)} className={inputCls} />
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-neutral-600">To (optional)</span>
            <input type="date" min={hFrom || `${data.year}-01-01`} max={`${data.year}-12-31`} value={hTo} onChange={(e) => setHTo(e.target.value)} className={inputCls} />
          </label>
          <label className="min-w-48 flex-1 space-y-1">
            <span className="block text-xs text-neutral-600">Name</span>
            <input value={hName} onChange={(e) => setHName(e.target.value)} placeholder="e.g. Company day off" className={`${inputCls} w-full`} />
          </label>
          <button type="button" disabled={busy === "holiday" || !hFrom || !hName.trim()} onClick={() => void saveHoliday()} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
            Add holiday
          </button>
        </div>
      </section>
    </div>
  );
}
