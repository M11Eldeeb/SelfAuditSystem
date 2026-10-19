import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import { driveConfig } from "@/lib/google-drive";
import { buildMailAuthUrl } from "@/lib/gmail";
import { INVOICING_SCOPE } from "@/lib/invoicing/gmail-reader";

export const dynamic = "force-dynamic";

/**
 * Starts connecting a mailbox. Officers only. Default: the mailbox the portal sends e-mail from (send only).
 * `?purpose=invoicing`: the mailbox the daily invoicing report arrives in (read only) - same Google callback.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const invoicing = url.searchParams.get("purpose") === "invoicing";
  const back = (flag: string) => NextResponse.redirect(invoicing ? `${origin}/admin/dashboard?tab=invoicing&mail=${flag}` : `${origin}/admin/emails?mail=${flag}`);

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);
  if (user.role !== "officer") return NextResponse.json({ error: "Only an officer can connect the e-mail sender." }, { status: 403 });
  if (!driveConfig()) return back("not-configured");

  // A random value that must come back unchanged from Google, so a forged callback is rejected.
  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(buildMailAuthUrl(`${origin}/api/google-mail/callback`, state, invoicing ? INVOICING_SCOPE : undefined));
  response.cookies.set("gm_state", state, {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/api/google-mail",
    maxAge: 600,
  });
  response.cookies.set("gm_purpose", invoicing ? "invoicing" : "sender", {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/api/google-mail",
    maxAge: 600,
  });
  return response;
}
