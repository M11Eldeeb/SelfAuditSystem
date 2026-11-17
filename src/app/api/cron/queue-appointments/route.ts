import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { importLatestAppointmentsMail } from "@/lib/queue/appointments";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Every hour during the day (migration 0185): reads the newest DMS appointments e-mail when there is a new one. */
export async function GET(request: Request) {
  if (!(await isCronAuthorized(request))) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return NextResponse.json(await importLatestAppointmentsMail());
}
