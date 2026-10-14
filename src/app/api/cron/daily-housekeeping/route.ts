import { NextResponse } from "next/server";
import { GET as cleanupFiles } from "../cleanup-feedback-files/route";
import { GET as syncSharing } from "../sync-drive-sharing/route";
import { getMailStatus } from "@/lib/gmail";
import { MAIL_KEYS, isMailEnabled, planPodium, sendPlans } from "@/lib/mail/plans";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The daily job at 06:00 UTC = 09:00 in Saudi Arabia, Sunday to Thursday (vercel.json). It sends the podium
 * congratulations when it is due (if that mail is switched on) and then runs the two housekeeping tasks -
 * clearing orphaned uploads and keeping the Google Drive sharing in step with the website's accounts. They are
 * separate routes (each can still be called alone); this exists because the free plan has two scheduled jobs and
 * the other one sends the 08:30 reminders. Each housekeeping task checks the CRON_SECRET itself.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
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
