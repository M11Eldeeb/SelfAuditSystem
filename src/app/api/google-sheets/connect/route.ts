import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import { driveConfig } from "@/lib/google-drive";
import { SHEETS_STATE_COOKIE, buildSheetsAuthUrl } from "@/lib/google-sheets";

export const dynamic = "force-dynamic";

/** Starts connecting the Google account that can open the Prior Approvals sheet (read-only). Officers only. */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const back = (flag: string) => NextResponse.redirect(`${origin}/admin/dashboard?tab=warranty&view=warranty&sheets=${flag}`);

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);
  if (user.role !== "officer") return NextResponse.json({ error: "Only an officer can connect Google Sheets." }, { status: 403 });
  if (!driveConfig()) return back("not-configured");

  const state = randomBytes(24).toString("hex");
  // The Drive connection's registered redirect address is reused; its callback tells the two flows apart by this cookie.
  const response = NextResponse.redirect(buildSheetsAuthUrl(`${origin}/api/google-drive/callback`, state));
  response.cookies.set(SHEETS_STATE_COOKIE, state, {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/api/google-drive",
    maxAge: 600,
  });
  return response;
}
