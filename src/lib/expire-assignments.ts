import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * There's no scheduled job in this app (keeps it on Vercel's free tier), so
 * the 30-day submission deadline is enforced lazily: called from the pages
 * officers and branch admins actually visit, it flips any claim assignment
 * still not_started/in_progress on a cycle whose deadline has passed to
 * 'expired'. Scoring treats 'expired' as a flat 0% (see finalizeBranchAudit)
 * and the officer review queue skips it entirely - there's nothing to review
 * since the branch admin never submitted it.
 */
export async function expireOverdueAssignments(): Promise<void> {
  const supabase = createAdminClient();

  const { data: overdueCycles } = await supabase
    .from("self_audit_audit_cycles")
    .select("id")
    .not("deadline_at", "is", null)
    .lt("deadline_at", new Date().toISOString());

  if (!overdueCycles || overdueCycles.length === 0) return;

  await supabase
    .from("self_audit_audit_assignments")
    .update({ status: "expired" })
    .in(
      "cycle_id",
      overdueCycles.map((c) => c.id)
    )
    .in("status", ["not_started", "in_progress"]);
}
