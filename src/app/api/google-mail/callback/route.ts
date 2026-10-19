import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import { DRIVE_ALLOWED_DOMAIN } from "@/lib/google-drive";
import { exchangeMailCode, saveMailConnection } from "@/lib/gmail";
import { INVOICING_SCOPE, saveInvoicingConnection } from "@/lib/invoicing/gmail-reader";

export const dynamic = "force-dynamic";

function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Where Google sends the officer back after they allow the portal to send mail
 * as the mailbox they signed in with. Checks the state, trades the code for a
 * refresh token, makes sure it is a company mailbox that really granted
 * "send", and saves the connection.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const invoicing = request.headers.get("cookie")?.match(/(?:^|;\s*)gm_purpose=([^;]+)/)?.[1] === "invoicing";
  const done = (flag: string, detail?: string) => {
    const extra = detail ? `&detail=${encodeURIComponent(detail.slice(0, 240))}` : "";
    const res = NextResponse.redirect(invoicing ? `${origin}/admin/dashboard?tab=invoicing&mail=${flag}${extra}` : `${origin}/admin/emails?mail=${flag}${extra}`);
    res.cookies.delete({ name: "gm_state", path: "/api/google-mail" });
    res.cookies.delete({ name: "gm_purpose", path: "/api/google-mail" });
    return res;
  };

  const user = await getCurrentUser();
  if (!user || user.role !== "officer") return NextResponse.redirect(`${origin}/login`);

  if (url.searchParams.get("error")) return done("cancelled");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.headers.get("cookie")?.match(/(?:^|;\s*)gm_state=([^;]+)/)?.[1];
  if (!code || !state || !cookieState || !sameState(state, cookieState)) return done("bad-state");

  let step = "exchanging the sign-in code with Google";
  try {
    const result = await exchangeMailCode(code, `${origin}/api/google-mail/callback`);
    if (!result.refreshToken) return done("no-refresh-token");
    step = "checking the mailbox";
    if (!result.email.endsWith(`@${DRIVE_ALLOWED_DOMAIN}`)) return done("wrong-account");
    if (invoicing) {
      // The Warranty Invoicing reader: read-only access to the mailbox the daily report arrives in.
      if (!result.scopes.includes(INVOICING_SCOPE)) return done("no-read-permission");
      step = "saving the connection";
      await saveInvoicingConnection({ refreshToken: result.refreshToken, accountEmail: result.email, connectedBy: user.id });
      return done("connected");
    }
    if (!result.canSend) return done("no-send-permission");

    step = "saving the connection";
    await saveMailConnection({ refreshToken: result.refreshToken, accountEmail: result.email, connectedBy: user.id });
    return done("connected");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`E-mail connect failed while ${step}:`, message);
    return done("failed", `While ${step}: ${message}`);
  }
}
