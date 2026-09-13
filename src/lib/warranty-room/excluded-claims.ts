import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { selectAllRows } from "@/lib/supabase/paginate";

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
 */
export async function getWarrantyRoomExcludedClaimIds(
  supabase: SupabaseClient<Database>
): Promise<Set<string>> {
  const [scrapRequests, scrapped, handedOverCollections] = await Promise.all([
    selectAllRows<{ claim_id: string }>(async (from, to) =>
      supabase.from("self_audit_scrap_requests").select("claim_id").range(from, to)
    ),
    selectAllRows<{ claim_id: string | null }>(async (from, to) =>
      supabase.from("self_audit_scrapped_parts").select("claim_id").range(from, to)
    ),
    selectAllRows<{ id: string }>(async (from, to) =>
      supabase.from("self_audit_supplier_collections").select("id").eq("status", "handed_over").range(from, to)
    ),
  ]);

  const handedOverCollectionIds = handedOverCollections.map((c) => c.id);
  const handedOverParts = handedOverCollectionIds.length
    ? await selectAllRows<{ claim_id: string | null }>(async (from, to) =>
        supabase
          .from("self_audit_supplier_collection_parts")
          .select("claim_id")
          .in("collection_id", handedOverCollectionIds)
          .range(from, to)
      )
    : [];

  return new Set([
    ...scrapRequests.map((r) => r.claim_id),
    ...scrapped.map((r) => r.claim_id).filter((id): id is string => !!id),
    ...handedOverParts.map((r) => r.claim_id).filter((id): id is string => !!id),
  ]);
}
