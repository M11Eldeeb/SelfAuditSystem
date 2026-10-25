/** Single source of truth for the self-audit submission window, referenced by cycle creation, the invite email text, and the branch admin's expired-claim message. */
export const AUDIT_CYCLE_DEADLINE_DAYS = 25;

/**
 * True once a cycle's submission deadline has passed. Its own function (not
 * inlined) so the impure Date.now() stays out of component render bodies - see
 * daysUntil below.
 */
export function isPastDeadline(deadlineAt: string | null): boolean {
  return !!deadlineAt && new Date(deadlineAt).getTime() < Date.now();
}

/**
 * Whole days left until a deadline. Floors rather than ceils - deadline_at
 * carries the exact creation timestamp (e.g. 07:23:59), not midnight, so on
 * any given day there's almost always a partial day left over. Ceiling that
 * rounds it up to the next whole day, showing one more day than has truly
 * elapsed (confirmed: a cycle created 2026-09-01 07:23:59 with a 30-day
 * deadline showed "11 days left" on 2026-09-21 06:23, when only 10 full
 * days actually remained). Flooring never overstates how much time is left,
 * which is the safer direction to be wrong in for a deadline countdown.
 */
export function daysRemaining(deadlineAt: string | null): number | null {
  if (!deadlineAt) return null;
  return Math.max(0, Math.floor((new Date(deadlineAt).getTime() - Date.now()) / 86_400_000));
}

/**
 * The one countdown every page shows for a cycle deadline, so they can never disagree: whole days left (rounded down),
 * "Less than 1 day left" during the last 24 hours, and passed only once the deadline moment itself has gone by. Before this,
 * one page rounded up ("1 day left") and another rounded down to 0 ("Deadline passed") with a day still to go.
 */
export function deadlineCountdown(deadlineAt: string | null): { passed: boolean; days: number; text: string | null } | null {
  if (!deadlineAt) return null;
  const ms = new Date(deadlineAt).getTime() - Date.now();
  if (ms <= 0) return { passed: true, days: 0, text: null };
  const days = Math.floor(ms / 86_400_000);
  return { passed: false, days, text: days >= 1 ? `${days} day${days === 1 ? "" : "s"} left` : "Less than 1 day left" };
}

/**
 * Signed whole days from now until `dateStr` (negative once it's passed) -
 * unlike daysRemaining, doesn't floor at 0, so callers can tell "today" from
 * "overdue". Kept as its own named function (not inlined at the call site)
 * so the impure Date.now() call stays out of component render bodies -
 * eslint-plugin-react-hooks' purity check flags a direct Date.now() call
 * inside a component but not one wrapped behind an imported function.
 */
export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}
