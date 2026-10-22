// Internal audit days - shared by the schedule page and its server actions.
// An audit starts on its planned date and runs for `days` working days: Fridays, Saturdays and holidays are skipped.
// No audit day may fall in the last week (last 7 days) of a month.

export const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
export const isWeekend = (day: string) => weekdayOf(day) === 5 || weekdayOf(day) === 6;

export function isLastWeek(day: string): boolean {
  const d = new Date(`${day}T00:00:00Z`);
  const monthDays = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return d.getUTCDate() > monthDays - 7;
}

const addDay = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** The audit's days: the start date, then the next working days until `days` are counted. */
export function auditDays(start: string, days: number, holidays: Set<string>): string[] {
  const out = [start];
  let d = start;
  for (let guard = 0; out.length < days && guard < 60; guard++) {
    d = addDay(d);
    if (!isWeekend(d) && !holidays.has(d)) out.push(d);
  }
  return out;
}

/** Why these audit days cannot be used, or null. */
export function auditDaysProblem(days: string[]): string | null {
  const bad = days.find(isLastWeek);
  if (bad) return `The audit would reach the last week of ${new Date(`${bad}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })} - no audits in the last week of the month. Pick an earlier start.`;
  return null;
}
