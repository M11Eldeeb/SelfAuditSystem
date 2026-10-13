import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import {
  DRIVE_ALLOWED_DOMAIN,
  DRIVE_ROOT_FOLDER_NAME,
  DriveError,
  accountEmailFor,
  createFolderWithToken,
  exchangeCode,
  saveDriveConnection,
} from "@/lib/google-drive";

export const dynamic = "force-dynamic";

function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Where Google sends the officer back after they press Allow. Checks the state,
 * trades the code for a refresh token, makes sure the account is a company one,
 * creates the "Rejected Claims From Workshop" folder and saves the connection.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const done = (flag: string) => {
    const res = NextResponse.redirect(`${origin}/admin/rejected-claims?drive=${flag}`);
    res.cookies.delete({ name: "gd_state", path: "/api/google-drive" });
    return res;
  };

  const user = await getCurrentUser();
  if (!user || user.role !== "officer") return NextResponse.redirect(`${origin}/login`);

  if (url.searchParams.get("error")) return done("cancelled");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.headers.get("cookie")?.match(/(?:^|;\s*)gd_state=([^;]+)/)?.[1];
  if (!code || !state || !cookieState || !sameState(state, cookieState)) return done("bad-state");

  try {
    const tokens = await exchangeCode(code, `${origin}/api/google-drive/callback`);
    if (!tokens.refresh_token) return done("no-refresh-token");

    const email = await accountEmailFor(tokens.access_token);
    if (!email.endsWith(`@${DRIVE_ALLOWED_DOMAIN}`)) return done("wrong-account");

    const rootFolderId = await createFolderWithToken(tokens.access_token, DRIVE_ROOT_FOLDER_NAME);
    await saveDriveConnection({ refreshToken: tokens.refresh_token, accountEmail: email, rootFolderId, connectedBy: user.id });
    return done("connected");
  } catch (e) {
    console.error("Google Drive connect failed:", e instanceof DriveError ? e.message : e);
    return done("failed");
  }
}
