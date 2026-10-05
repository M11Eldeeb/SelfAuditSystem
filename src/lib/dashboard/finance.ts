import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export type FinanceMonth = { month: string; claimCount: number; totalAdjusted: number };

/**
 * Total "Adjusted Claim TOL." per First Submit Date year-month, for every
 * submitted claim that isn't Closed, Settled, Rejected or Rejected from
 * Chief Agent. Aggregated in Postgres by get_finance_summary (migration
 * 0067), which also enforces that only finance and officer accounts can
 * call it.
 */
export async function getFinanceSummary(
  supabase: SupabaseClient<Database>
): Promise<{ months: FinanceMonth[]; currency: string }> {
  const { data, error } = await supabase.rpc("get_finance_summary");
  if (error) throw new Error(error.message || "Could not load the finance summary.");

  const rows = (data ?? []).filter((r) => /^\d{4}-\d{2}$/.test(r.month));
  const currencyCounts = new Map<string, number>();
  for (const r of rows) if (r.currency) currencyCounts.set(r.currency, (currencyCounts.get(r.currency) ?? 0) + Number(r.claim_count));

  return {
    months: rows.map((r) => ({ month: r.month, claimCount: Number(r.claim_count), totalAdjusted: Number(r.total_adjusted) })),
    currency: [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "SAR",
  };
}
