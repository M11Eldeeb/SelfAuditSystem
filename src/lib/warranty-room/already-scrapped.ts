import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export type AlreadyScrappedRow = {
  claim_number: string;
  work_order_no: string | null;
  status: string;
  part_no: string | null;
  part_name: string | null;
  quantity: number | null;
  holding_period_days: number | null;
  first_submit_date: string | null;
  repair_end_date: string | null;
  submitted_at: string | null;
};

/**
 * Claims confirmed already scrapped - either the branch submitted
 * destruction video and the officer approved it ('scrapped'), it's in the
 * destroy list ('scrapped_legacy'), or the supplier collected it
 * ('supplier_collected'). Nothing is ever presumed scrapped just because
 * time passed (migration 0060 retired that). Computed server-side
 * (get_already_scrapped_claims, migration 0044) for the same reason
 * get_do_not_scrap_claims is: some branches carry 600+ scrap requests, too
 * many to safely fetch by id list from the client.
 */
export async function getAlreadyScrappedClaims(
  supabase: SupabaseClient<Database>,
  branchId: string
): Promise<AlreadyScrappedRow[]> {
  const { data, error } = await supabase.rpc("get_already_scrapped_claims", { p_branch_id: branchId });
  if (error) throw new Error(error.message);
  return data ?? [];
}
