import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export type FlaggedToScrapRow = {
  claim_number: string;
  work_order_no: string | null;
  part_no: string | null;
  part_name: string | null;
  quantity: number | null;
  holding_period_days: number | null;
  first_submit_date: string | null;
  repair_end_date: string | null;
  /** The warranty room cycle this part was flagged in (e.g. "2026-10-01") - null if flagged before cycles existed. */
  cycle_month: string | null;
};

/**
 * Claims whose scrap request is still 'pending' - holding period exceeded
 * 90 days, awaiting the branch's destroy evidence and the officer's
 * approval. The other half of the split that used to be one combined
 * Scrapping List (migration 0056): this is "action needed", Scrapped List
 * (get_already_scrapped_claims) is "already done". Reads the same
 * self_audit_already_scrapped_cache table (0051), just filtered to
 * status='pending'.
 */
export async function getFlaggedToScrapClaims(
  supabase: SupabaseClient<Database>,
  branchId: string
): Promise<FlaggedToScrapRow[]> {
  const { data, error } = await supabase.rpc("get_flagged_to_scrap_claims", { p_branch_id: branchId });
  if (error) throw new Error(error.message);
  return data ?? [];
}
