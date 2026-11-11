import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { syncSubDealerWips } from "@/lib/sub-dealer-wips";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Every 30 minutes (migration 0165): reads the sub-dealer's live sheet, refreshes the list, and takes its claims out of the open audits. */
export async function GET(request: Request) {
  if (!(await isCronAuthorized(request))) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return NextResponse.json(await syncSubDealerWips());
}
