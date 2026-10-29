import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { importOpenWipsFromSheet } from "@/lib/open-wips/import";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Twice a day (05:00 and 13:00 UTC, every day - migration 0150): reads the open-WIP report and writes the daily count. */
export async function GET(request: Request) {
  if (!(await isCronAuthorized(request))) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return NextResponse.json(await importOpenWipsFromSheet("Daily job"));
}
