// Customer queue working hours: when a branch takes new customers at the kiosk. Shared by the browser and the server.

export type DayHours = { open: boolean; first: string; last: string; breakStart: string | null; breakEnd: string | null };
/** Index 0 = Sunday ... 6 = Saturday. */
export type Schedule = DayHours[];
export type Override = "open" | "closed" | null;

/** Sat-Wed 08:00-17:30, Thu 08:00-13:30, break 12:00-13:00, Friday closed. */
export const DEFAULT_SCHEDULE: Schedule = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
  open: d !== 5,
  first: "08:00",
  last: d === 4 ? "13:30" : "17:30",
  breakStart: "12:00",
  breakEnd: "13:00",
}));

export const DAY_NAMES: [string, string][] = [
  ["Sunday", "الأحد"],
  ["Monday", "الاثنين"],
  ["Tuesday", "الثلاثاء"],
  ["Wednesday", "الأربعاء"],
  ["Thursday", "الخميس"],
  ["Friday", "الجمعة"],
  ["Saturday", "السبت"],
];
/** Saturday first, as the week is read in Saudi Arabia. */
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];

const hm = (v: unknown, fallback: string | null) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : fallback);

/** A saved schedule, cleaned (anything missing or wrong falls back to the default for that day). */
export function cleanSchedule(raw: unknown): Schedule {
  const list = Array.isArray(raw) ? raw : [];
  return DEFAULT_SCHEDULE.map((def, i) => {
    const d = (list[i] ?? {}) as Partial<DayHours>;
    const first = hm(d.first, def.first)!;
    const last = hm(d.last, def.last)!;
    const breakStart = d.breakStart === null ? null : hm(d.breakStart, def.breakStart);
    const breakEnd = d.breakEnd === null ? null : hm(d.breakEnd, def.breakEnd);
    const hasBreak = !!breakStart && !!breakEnd && breakStart < breakEnd;
    return { open: typeof d.open === "boolean" ? d.open : def.open, first, last: last > first ? last : def.last, breakStart: hasBreak ? breakStart : null, breakEnd: hasBreak ? breakEnd : null };
  });
}

/** Saudi time now: the weekday (0 = Sunday), "HH:MM" and the date. */
export function saudiNow(now = new Date()) {
  const r = new Date(now.getTime() + 3 * 3600_000);
  return { day: r.getUTCDay(), time: `${String(r.getUTCHours()).padStart(2, "0")}:${String(r.getUTCMinutes()).padStart(2, "0")}`, date: r.toISOString().slice(0, 10) };
}

export type Receiving =
  | { open: true; why: "hours" | "manual"; until: string | null } // until: the next break or the last customer time
  | { open: false; why: "manual" | "break" | "before" | "after" | "day_off"; next: { day: number; time: string; today: boolean; tomorrow: boolean } | null };

/** Is the branch taking new customers now, and if not, when next. */
export function receivingNow(schedule: Schedule, override: Override, overrideDate: string | null, now = new Date()): Receiving {
  const n = saudiNow(now);
  const manual = override && overrideDate === n.date ? override : null;
  const today = schedule[n.day];
  const next = () => {
    for (let k = 0; k <= 7; k++) {
      const d = (n.day + k) % 7;
      const s = schedule[d];
      if (!s.open) continue;
      if (k === 0) {
        if (n.time < s.first) return { day: d, time: s.first, today: true, tomorrow: false };
        if (s.breakStart && s.breakEnd && n.time >= s.breakStart && n.time < s.breakEnd && s.breakEnd <= s.last) return { day: d, time: s.breakEnd, today: true, tomorrow: false };
        continue;
      }
      return { day: d, time: s.first, today: false, tomorrow: k === 1 };
    }
    return null;
  };
  if (manual === "open") return { open: true, why: "manual", until: null };
  if (manual === "closed") return { open: false, why: "manual", next: null };
  if (!today.open) return { open: false, why: "day_off", next: next() };
  if (n.time < today.first) return { open: false, why: "before", next: next() };
  if (n.time >= today.last) return { open: false, why: "after", next: next() };
  if (today.breakStart && today.breakEnd && n.time >= today.breakStart && n.time < today.breakEnd) return { open: false, why: "break", next: next() };
  return { open: true, why: "hours", until: today.breakStart && n.time < today.breakStart ? today.breakStart : today.last };
}

/** "8:00 AM" / "1:30 PM" (or Arabic). */
export function clockText(t: string, lang: "en" | "ar") {
  const [h, m] = t.split(":").map(Number);
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString(lang === "ar" ? "ar-SA-u-nu-latn" : "en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

/** One line for the customer / TV: "Receiving customers", "Closed - we open Sunday at 8:00 AM"... */
export function receivingText(r: Receiving, lang: "en" | "ar"): string {
  const ar = lang === "ar";
  if (r.open) return ar ? "نستقبل العملاء الآن" : "Receiving customers";
  if (r.why === "break") return r.next ? (ar ? `استراحة - نعود الساعة ${clockText(r.next.time, lang)}` : `On a break - back at ${clockText(r.next.time, lang)}`) : ar ? "استراحة" : "On a break";
  if (!r.next) return ar ? "الاستقبال مغلق الآن" : "Not receiving customers now";
  const when = r.next.today
    ? ar
      ? `اليوم الساعة ${clockText(r.next.time, lang)}`
      : `today at ${clockText(r.next.time, lang)}`
    : r.next.tomorrow
    ? ar
      ? `غداً الساعة ${clockText(r.next.time, lang)}`
      : `tomorrow at ${clockText(r.next.time, lang)}`
    : ar
    ? `يوم ${DAY_NAMES[r.next.day][1]} الساعة ${clockText(r.next.time, lang)}`
    : `${DAY_NAMES[r.next.day][0]} at ${clockText(r.next.time, lang)}`;
  return ar ? `مغلق - نستقبل العملاء ${when}` : `Closed - we receive customers ${when}`;
}
