import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Every claim the warranty room process has already claimed, so a fresh
 * self-audit/internal-audit sample never re-picks a claim with nothing left
 * to physically check: queued or already scrapped (any status - once it's
 * in the pipeline there's no part left to inspect), or handed over to the
 * manufacturer's supplier (only once handed over - before that the part is
 * still sitting in the branch and is fair game to sample). See
 * src/app/admin/cycles/actions.ts (generateCycle) and
 * src/app/admin/internal-audit/actions.ts (sampleEligibleClaims,
 * startInternalAudit), unioned there with getAuditedClaimIds().
 *
 * Computed server-side by get_warranty_room_excluded_claim_ids (migration
 * 0023) rather than fetched and filtered in JS - self_audit_scrapped_parts
 * alone can run 30,000+ rows, and paginating through it 1000 rows at a time
 * took tens of seconds on every cycle generation / sample run.
 */
export async function getWarrantyRoomExcludedClaimIds(
  supabase: SupabaseClient<Database>
): Promise<Set<string>> {
  const { data, error } = await supabase.rpc("get_warranty_room_excluded_claim_ids");
  if (error) throw new Error(error.message);
  return new Set(data ?? []);
}
