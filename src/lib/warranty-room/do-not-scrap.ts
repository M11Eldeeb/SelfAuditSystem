import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { selectAllRows } from "@/lib/supabase/paginate";

export type DoNotScrapRow = {
  claim_number: string;
  work_order_no: string | null;
  vin: string | null;
  main_part_name: string | null;
  creation_date: string;
};

/**
 * Every claim with parts for a branch, minus anything already flagged
 * should-be-scrapped or already-scrapped - what's left is a claim the
 * branch is holding a part for but was never told to destroy, so it
 * shouldn't be scrapped without being told to. Paginated throughout (see
 * src/lib/audited-claims.ts for the same pattern) - a busy branch can have
 * well over PostgREST's 1000-row default page size worth of claims.
 */
export async function getDoNotScrapClaims(
  supabase: SupabaseClient<Database>,
  branchId: string
): Promise<DoNotScrapRow[]> {
  const claims = await selectAllRows<{
    id: string;
    claim_number: string;
    work_order_no: string | null;
    vin: string | null;
    main_part_name: string | null;
    creation_date: string;
  }>(async (from, to) =>
    supabase
      .from("self_audit_claims")
      .select("id, claim_number, work_order_no, vin, main_part_name, creation_date")
      .eq("branch_id", branchId)
      .eq("has_parts", true)
      .range(from, to)
  );

  const claimIds = claims.map((c) => c.id);
  if (claimIds.length === 0) return [];

  const [scrapRequests, scrapped] = await Promise.all([
    selectAllRows<{ claim_id: string }>(async (from, to) =>
      supabase.from("self_audit_scrap_requests").select("claim_id").in("claim_id", claimIds).range(from, to)
    ),
    selectAllRows<{ claim_id: string | null }>(async (from, to) =>
      supabase.from("self_audit_scrapped_parts").select("claim_id").in("claim_id", claimIds).range(from, to)
    ),
  ]);

  const excludedIds = new Set([
    ...scrapRequests.map((r) => r.claim_id),
    ...scrapped.map((r) => r.claim_id).filter((id): id is string => !!id),
  ]);

  return claims
    .filter((c) => !excludedIds.has(c.id))
    .map((c) => ({
      claim_number: c.claim_number,
      work_order_no: c.work_order_no,
      vin: c.vin,
      main_part_name: c.main_part_name,
      creation_date: c.creation_date,
    }));
}
