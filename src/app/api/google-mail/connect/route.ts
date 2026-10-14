import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import { driveConfig } from "@/lib/google-drive";
import { buildMailAuthUrl } from "@/lib/gmail";

export const dynamic = "force-dynamic";

/** Starts connecting the mailbox the portal sends e-mail from. Officers only. */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const back = (flag: string) => NextResponse.redirect(`${origin}/admin/emails?mail=${flag}`);

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);
  if (user.role !== "officer") return NextResponse.json({ error: "Only an officer can connect the e-mail sender." }, { status: 403 });
  if (!driveConfig()) return back("not-configured");

  // A random value that must come back unchanged from Google, so a forged callback is rejected.
  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(buildMailAuthUrl(`${origin}/api/google-mail/callback`, state));
  response.cookies.set("gm_state", state, {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/api/google-mail",
    maxAge: 600,
  });
  return response;
}
