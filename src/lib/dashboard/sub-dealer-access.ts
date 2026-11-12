import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/** The sub-dealer's job cards are Heraa work orders (HER), so only that branch has Sub-Dealer Analytics of its own. */
const SUB_DEALER_BRANCH_CODES = ["HER"];

/** Does this branch have sub-dealer work (a service manager of another branch has nothing to look at)? */
export async function branchHasSubDealer(supabase: SupabaseClient<Database>, branchId: string | null | undefined): Promise<boolean> {
  if (!branchId) return false;
  const { data } = await supabase.from("self_audit_branches").select("code").eq("id", branchId).maybeSingle();
  return !!data?.code && SUB_DEALER_BRANCH_CODES.includes(data.code);
}
