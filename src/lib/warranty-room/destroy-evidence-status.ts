import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { selectAllRows } from "@/lib/supabase/paginate";

export type DestroyEvidenceState = "not_submitted" | "awaiting_approval" | "approved";

/** Maps the raw self_audit_destroy_evidence status (or no row at all) to what the officer sees. */
export function destroyEvidenceState(status: string | null | undefined): DestroyEvidenceState {
  if (status === "sent") return "approved";
  if (status === "submitted") return "awaiting_approval";
  return "not_submitted"; // no row yet, or 'pending' (branch started uploading but never submitted)
}

/**
 * How many claims each branch had flagged to scrap in each warranty room
 * cycle, any status - a request moves to 'scrapped' on approval but still
 * belongs to its cycle, so an approved branch keeps showing. cycleId narrows
 * it to one cycle.
 */
export async function getFlaggedClaimCountsByCycleBranch(
  supabase: SupabaseClient<Database>,
  cycleId?: string
): Promise<Map<string, Map<string, number>>> {
  const rows = await selectAllRows<{ cycle_id: string | null; branch_id: string }>(async (from, to) => {
    let query = supabase.from("self_audit_scrap_requests").select("cycle_id, branch_id").not("cycle_id", "is", null);
    if (cycleId) query = query.eq("cycle_id", cycleId);
    return query.order("id").range(from, to);
  });

  const counts = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.cycle_id) continue;
    const byBranch = counts.get(r.cycle_id) ?? new Map<string, number>();
    byBranch.set(r.branch_id, (byBranch.get(r.branch_id) ?? 0) + 1);
    counts.set(r.cycle_id, byBranch);
  }
  return counts;
}
