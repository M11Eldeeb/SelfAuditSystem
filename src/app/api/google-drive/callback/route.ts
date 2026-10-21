import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import {
  DRIVE_ALLOWED_DOMAIN,
  DRIVE_ROOT_FOLDER_NAME,
  DRIVE_SHARED_DRIVE_ID,
  accountEmailFor,
  createFolderWithToken,
  exchangeCode,
  findFolderWithToken,
  saveDriveConnection,
  syncDriveSharing,
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
 * creates the "Rejected Claims From Workshop" folder inside the company Shared
 * Drive and saves the connection.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const done = (flag: string, detail?: string) => {
    // detail is Google's own error text (never a secret); only officers see this page.
    const extra = detail ? `&detail=${encodeURIComponent(detail.slice(0, 240))}` : "";
    const res = NextResponse.redirect(`${origin}/admin/rejected-claims?drive=${flag}${extra}`);
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

  // Each step is named, so a failure says exactly where it stopped.
  let step = "exchanging the sign-in code with Google";
  try {
    const tokens = await exchangeCode(code, `${origin}/api/google-drive/callback`);
    if (!tokens.refresh_token) return done("no-refresh-token");

    step = "reading which Google account connected";
    const email = await accountEmailFor(tokens.access_token);
    if (!email.endsWith(`@${DRIVE_ALLOWED_DOMAIN}`)) return done("wrong-account");

    step = "creating the folder in the Rejected Claims From The Branch Shared Drive";
    // Reuse the folder if it is already there (a reconnect must not start a second one).
    const rootFolderId =
      (await findFolderWithToken(tokens.access_token, DRIVE_ROOT_FOLDER_NAME, DRIVE_SHARED_DRIVE_ID)) ??
      (await createFolderWithToken(tokens.access_token, DRIVE_ROOT_FOLDER_NAME, DRIVE_SHARED_DRIVE_ID));

    step = "saving the connection";
    await saveDriveConnection({ refreshToken: tokens.refresh_token, accountEmail: email, rootFolderId, connectedBy: user.id });

    // Best effort: the connection is already saved, so a sharing hiccup must not undo it.
    step = "sharing the folder with the officers";
    const sharing = await syncDriveSharing().catch(() => null);
    const note = sharing
      ? `Shared with ${sharing.shared} person(s)${sharing.failed.length ? `; could not share with ${sharing.failed.map((f) => f.email).join(", ")}` : ""}. Branch folders are shared with their branch admins automatically.`
      : "Sharing will be retried automatically.";
    return done("connected", note);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`Google Drive connect failed while ${step}:`, message);
    return done("failed", `While ${step}: ${message}`);
  }
}
