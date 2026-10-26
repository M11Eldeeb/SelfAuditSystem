import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Marks a self-audit cycle 'completed' once every branch that has work in it has a finalized result. Called after
 * each branch is finalized, so the cycle stops showing as open without anyone having to close it by hand.
 */
export async function completeCycleIfFinished(supabase: SupabaseClient<Database>, cycleId: string): Promise<boolean> {
  const [{ data: assignments }, { data: results }] = await Promise.all([
    supabase.from("self_audit_audit_assignments").select("branch_id").eq("cycle_id", cycleId),
    supabase.from("self_audit_audit_results").select("branch_id").eq("cycle_id", cycleId),
  ]);
  const branches = new Set((assignments ?? []).map((a) => a.branch_id));
  if (branches.size === 0) return false;
  const finalized = new Set((results ?? []).map((r) => r.branch_id));
  if ([...branches].some((b) => !finalized.has(b))) return false;
  const { error } = await supabase.from("self_audit_audit_cycles").update({ status: "completed" }).eq("id", cycleId).eq("status", "open");
  return !error;
}
