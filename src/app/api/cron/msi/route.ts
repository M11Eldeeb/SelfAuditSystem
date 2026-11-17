import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { importLatestMsiReport } from "@/lib/msi/import";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Every 30 minutes in the morning (migration 0181): reads the newest Major Service Indicators e-mail when there is a new one. */
export async function GET(request: Request) {
  if (!(await isCronAuthorized(request))) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return NextResponse.json(await importLatestMsiReport());
}
