import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { getMailStatus } from "@/lib/gmail";
import { MAIL_KEYS, isMailEnabled, planFlaggedParts, planSelfAuditReminders, sendPlans } from "@/lib/mail/plans";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily job at 05:30 UTC = 08:30 in Saudi Arabia, Sunday to Thursday, started by the database scheduler (pg_cron, migration 0133),
 * and once more at 08:30 UTC in case the first call failed. Sends the automatic
 * mails that are switched on and due: the self-audit reminders (7, 3 and 1 day before the deadline) and
 * the "parts flagged to scrap" mails with their reminders. A mail that already went out is skipped, so
 * running this twice - or by hand - is harmless. The caller must send the cron secret (lib/cron-auth).
 */
export async function GET(request: Request) {
  if (!(await isCronAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!(await getMailStatus())) return NextResponse.json({ skipped: "The e-mail sender is not connected." });

  const origin = new URL(request.url).origin;
  const summary: Record<string, unknown> = {};
  try {
    if (await isMailEnabled(MAIL_KEYS.selfAuditReminder)) summary.selfAuditReminders = await sendPlans(await planSelfAuditReminders(origin), null);
    else summary.selfAuditReminders = "switched off";
    if (await isMailEnabled(MAIL_KEYS.flaggedParts)) summary.flaggedParts = await sendPlans(await planFlaggedParts(origin), null);
    else summary.flaggedParts = "switched off";
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed.", summary }, { status: 500 });
  }
  return NextResponse.json(summary);
}
