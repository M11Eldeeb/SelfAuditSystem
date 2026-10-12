import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FEEDBACK_BUCKET } from "@/lib/feedback-constants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily job (vercel.json): deletes feedback files that no message points at
 * and are more than 24 hours old - what a failed or abandoned send leaves
 * behind. Referenced files and anything newer are never touched, so running
 * it more often or by hand is harmless. If CRON_SECRET is set (Vercel then
 * sends it as a bearer token on cron calls) it must match.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: paths, error } = await supabase.rpc("get_orphan_feedback_files", { p_older_than: "24 hours" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!paths || paths.length === 0) return NextResponse.json({ deleted: 0 });

  let deleted = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { data: removed, error: removeError } = await supabase.storage.from(FEEDBACK_BUCKET).remove(batch);
    if (removeError) return NextResponse.json({ error: removeError.message, deleted }, { status: 500 });
    deleted += removed?.length ?? 0;
  }
  return NextResponse.json({ deleted });
}
