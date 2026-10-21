import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { syncDriveSharing } from "@/lib/google-drive";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily job (started by daily-housekeeping): gives new accounts access to the Rejected Claims
 * Drive folders - officers to the whole folder, each branch's admins to their
 * branch's folder. It only ever adds access and skips people who already have
 * it, so running it more often or by hand is harmless. The caller must send the cron secret (lib/cron-auth).
 */
export async function GET(request: Request) {
  if (!(await isCronAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await syncDriveSharing();
    return NextResponse.json(result ?? { skipped: "Google Drive is not connected." });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sharing failed." }, { status: 500 });
  }
}
