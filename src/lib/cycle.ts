/** Single source of truth for the self-audit submission window, referenced by cycle creation, the invite email text, and the branch admin's expired-claim message. */
export const AUDIT_CYCLE_DEADLINE_DAYS = 25;

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
