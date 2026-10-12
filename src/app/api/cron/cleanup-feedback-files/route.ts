import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { FEEDBACK_BUCKET } from "@/lib/feedback-constants";
import { REJECTED_BUCKET } from "@/lib/rejected-claims";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily job (vercel.json): deletes feedback and Rejected Claims Diary files
 * that nothing points at and are more than 24 hours old - what a failed or
 * abandoned send leaves behind. Referenced files and anything newer are never touched, so running
 * it more often or by hand is harmless. If CRON_SECRET is set (Vercel then
 * sends it as a bearer token on cron calls) it must match.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Each bucket is swept on its own, so a failure in one never stops the other.
  async function sweep(rpc: "get_orphan_feedback_files" | "get_orphan_rejected_claim_files", bucket: string) {
    const { data: paths, error } = await supabase.rpc(rpc, { p_older_than: "24 hours" });
    if (error) return { deleted: 0, error: error.message };
    let deleted = 0;
    for (let i = 0; i < (paths ?? []).length; i += 100) {
      const { data: removed, error: removeError } = await supabase.storage.from(bucket).remove((paths ?? []).slice(i, i + 100));
      if (removeError) return { deleted, error: removeError.message };
      deleted += removed?.length ?? 0;
    }
    return { deleted };
  }

  const feedback = await sweep("get_orphan_feedback_files", FEEDBACK_BUCKET);
  const rejectedClaims = await sweep("get_orphan_rejected_claim_files", REJECTED_BUCKET);
  const failed = !!feedback.error || !!rejectedClaims.error;
  return NextResponse.json(
    { deleted: feedback.deleted + rejectedClaims.deleted, feedback, rejectedClaims },
    { status: failed ? 500 : 200 }
  );
}
