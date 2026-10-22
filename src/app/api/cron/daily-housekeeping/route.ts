import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { GET as cleanupFiles } from "../cleanup-feedback-files/route";
import { GET as syncSharing } from "../sync-drive-sharing/route";
import { getMailStatus } from "@/lib/gmail";
import { MAIL_KEYS, isMailEnabled, planPodium, sendPlans } from "@/lib/mail/plans";
import { importLatestInvoicingReport } from "@/lib/invoicing/import";
import { sendRejectedClaimMails } from "@/lib/mail/rejected-claims";
import { sendIaScheduleMails } from "@/lib/mail/ia-schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The daily job at 06:00 UTC = 09:00 in Saudi Arabia, Sunday to Thursday, started by the database scheduler (pg_cron, migration 0133). It sends the podium
 * congratulations when it is due (if that mail is switched on), imports the newest Warranty Invoicing report e-mail,
 * and then runs the two housekeeping tasks -
 * clearing orphaned uploads and keeping the Google Drive sharing in step with the website's accounts. They are
 * separate routes (each can still be called alone). Each housekeeping task checks the cron secret itself.
 */
export async function GET(request: Request) {
  if (!(await isCronAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const results: Record<string, unknown> = {};
  try {
    if ((await getMailStatus()) && (await isMailEnabled(MAIL_KEYS.podium))) {
      results.podium = await sendPlans(await planPodium(new URL(request.url).origin), null);
    } else {
      results.podium = "switched off or sender not connected";
    }
  } catch (e) {
    results.podium = { error: e instanceof Error ? e.message : "failed" };
  }
  // Warranty Invoicing: read the data analyst's newest daily report e-mail (skipped when nothing new arrived).
  try {
    results.invoicing = await importLatestInvoicingReport();
  } catch (e) {
    results.invoicing = { error: e instanceof Error ? e.message : "failed" };
  }
  // Rejected claims: the monthly summary (first run of the month) and the Thursday reminder for weekend close dates.
  try {
    results.rejectedClaims = await sendRejectedClaimMails(new URL(request.url).origin);
  } catch (e) {
    results.rejectedClaims = { error: e instanceof Error ? e.message : "failed" };
  }
  // Internal audit schedule: reminders to create the audit list before each planned audit, and the year's plan.
  try {
    results.iaSchedule = await sendIaScheduleMails(new URL(request.url).origin);
  } catch (e) {
    results.iaSchedule = { error: e instanceof Error ? e.message : "failed" };
  }
  for (const [name, task] of [["cleanup", cleanupFiles], ["driveSharing", syncSharing]] as const) {
    try {
      const res = await task(request);
      results[name] = { status: res.status, ...(await res.json().catch(() => ({}))) };
    } catch (e) {
      results[name] = { error: e instanceof Error ? e.message : "failed" };
    }
  }
  return NextResponse.json(results);
}
