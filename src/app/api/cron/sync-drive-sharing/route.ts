import { NextResponse } from "next/server";
import { syncDriveSharing } from "@/lib/google-drive";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily job (vercel.json): gives new accounts access to the Rejected Claims
 * Drive folders - officers to the whole folder, each branch's admins to their
 * branch's folder. It only ever adds access and skips people who already have
 * it, so running it more often or by hand is harmless. If CRON_SECRET is set
 * (Vercel then sends it as a bearer token on cron calls) it must match.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await syncDriveSharing();
    return NextResponse.json(result ?? { skipped: "Google Drive is not connected." });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sharing failed." }, { status: 500 });
  }
}
