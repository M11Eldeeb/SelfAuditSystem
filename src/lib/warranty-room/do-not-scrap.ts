import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

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
 * shouldn't be scrapped without being told to.
 *
 * Computed server-side by get_do_not_scrap_claims (migration 0022) rather
 * than fetched and filtered in JS - self_audit_scrapped_parts alone can run
 * 30,000+ rows, and paginating through it 1000 rows at a time (the
 * selectAllRows pattern used elsewhere) took 50+ seconds. A single indexed
 * query does the same exclusion in one round trip. It's security definer
 * (bypasses RLS), so the function itself enforces that a branch admin can
 * only ever pass their own branch_id.
 */
export async function getDoNotScrapClaims(
  supabase: SupabaseClient<Database>,
  branchId: string
): Promise<DoNotScrapRow[]> {
  const { data, error } = await supabase.rpc("get_do_not_scrap_claims", { p_branch_id: branchId });
  if (error) throw new Error(error.message);
  return data ?? [];
}
