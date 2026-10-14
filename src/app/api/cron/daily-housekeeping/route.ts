import { NextResponse } from "next/server";
import { GET as cleanupFiles } from "../cleanup-feedback-files/route";
import { GET as syncSharing } from "../sync-drive-sharing/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The daily 03:00 job (vercel.json): runs the two housekeeping tasks one after the other - clearing
 * orphaned uploads and keeping the Google Drive sharing in step with the website's accounts. They are
 * separate routes (each can still be called alone); this exists because the free plan has two scheduled
 * jobs and the other one is the e-mail reminders. Each task checks the CRON_SECRET itself.
 */
export async function GET(request: Request) {
  const results: Record<string, unknown> = {};
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
