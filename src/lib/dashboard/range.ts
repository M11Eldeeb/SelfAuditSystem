import { shiftMonth } from "@/lib/month";

const MONTH_RE = /^\d{4}-\d{2}$/;
const MAX_MONTHS = 12;

/**
 * Resolves the dashboard's repair-end-date month range from the query
 * string. Defaults to last month (the latest month with a complete set of
 * claims); anything over 12 months is clamped to the 12 ending at "to" to
 * keep the page fast.
 */
export function resolveMonthRange(params: { from?: string; to?: string }): {
  from: string;
  to: string;
  clamped: boolean;
} {
  const now = new Date();
  const lastMonth = shiftMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`, -1).slice(0, 7);

  let from = params.from && MONTH_RE.test(params.from) ? params.from : null;
  let to = params.to && MONTH_RE.test(params.to) ? params.to : null;
  to ??= from ?? lastMonth;
  from ??= to;
  if (from > to) [from, to] = [to, from];

  const earliest = shiftMonth(to, -(MAX_MONTHS - 1)).slice(0, 7);
  if (from < earliest) return { from: earliest, to, clamped: true };
  return { from, to, clamped: false };
}
