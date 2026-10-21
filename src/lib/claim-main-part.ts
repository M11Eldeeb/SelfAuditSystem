import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * The main part name of each claim. The claims sheet has no part-name column, so the database works it out from the
 * claim's first part number and the Part Details names (claim_main_part_name). For a handful of claims at a time -
 * pages that list thousands of claims must not call it.
 */
export async function loadMainPartNames(supabase: SupabaseClient<Database>, claimIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const ids = [...new Set(claimIds)];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.rpc("claims_main_part_names", { p_claim_ids: ids.slice(i, i + 200) });
    for (const r of data ?? []) if (r.main_part_name) names.set(r.claim_id, r.main_part_name);
  }
  return names;
}
