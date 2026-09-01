import type { Database } from "./supabase/types";

type Result = Database["public"]["Tables"]["self_audit_audit_results"]["Row"];

export const STANDINGS_PERIODS = ["1", "3", "6"] as const;
export type StandingsPeriod = (typeof STANDINGS_PERIODS)[number];

export const STANDINGS_PERIOD_LABELS: Record<StandingsPeriod, string> = {
  "1": "Latest cycle",
  "3": "Last 3 cycles (avg)",
  "6": "Last 6 cycles (avg)",
};

export function parseStandingsPeriod(value: string | undefined): StandingsPeriod {
  return (STANDINGS_PERIODS as readonly string[]).includes(value ?? "") ? (value as StandingsPeriod) : "1";
}

export type StandingsEntry = {
  branchId: string;
  name: string;
  avg: number;
  cyclesUsed: number;
};

export function computeStandings(
  results: Result[],
  branches: { id: string; name: string }[],
  cycleMonthById: Map<string, string>,
  period: StandingsPeriod
): StandingsEntry[] {
  const n = Number(period);

  const entries: StandingsEntry[] = [];
  for (const branch of branches) {
    const branchResults = results
      .filter((r) => r.branch_id === branch.id && cycleMonthById.has(r.cycle_id))
      .sort((a, b) => cycleMonthById.get(b.cycle_id)!.localeCompare(cycleMonthById.get(a.cycle_id)!))
      .slice(0, n);
    if (branchResults.length === 0) continue;
    const avg = branchResults.reduce((sum, r) => sum + r.score_pct, 0) / branchResults.length;
    entries.push({
      branchId: branch.id,
      name: branch.name,
      avg: Math.round(avg * 10) / 10,
      cyclesUsed: branchResults.length,
    });
  }

  return entries.sort((a, b) => b.avg - a.avg);
}
