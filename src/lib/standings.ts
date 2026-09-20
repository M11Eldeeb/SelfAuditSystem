import type { Database } from "./supabase/types";

type Result = Database["public"]["Tables"]["self_audit_audit_results"]["Row"];

export type StandingsEntry = {
  branchId: string;
  name: string;
  avg: number;
  cyclesUsed: number;
};

/**
 * Podium: strictly this cycle's finalized results - a branch not yet
 * finalized for the current cycle doesn't appear, even if an older result
 * would otherwise make it look good. currentCycleId is null when there's no
 * open cycle, which just means no podium.
 */
export function computeCurrentCycleStandings(
  results: Result[],
  branches: { id: string; name: string }[],
  currentCycleId: string | null
): StandingsEntry[] {
  if (!currentCycleId) return [];
  const nameById = new Map(branches.map((b) => [b.id, b.name]));

  const entries: StandingsEntry[] = results
    .filter((r) => r.cycle_id === currentCycleId && nameById.has(r.branch_id))
    .map((r) => ({
      branchId: r.branch_id,
      name: nameById.get(r.branch_id)!,
      avg: Math.round(r.score_pct * 10) / 10,
      cyclesUsed: 1,
    }));

  return entries.sort((a, b) => b.avg - a.avg);
}

/** Standings: each branch's average across every finalized cycle on file, not just a recent window. */
export function computeOverallStandings(
  results: Result[],
  branches: { id: string; name: string }[]
): StandingsEntry[] {
  const entries: StandingsEntry[] = [];
  for (const branch of branches) {
    const branchResults = results.filter((r) => r.branch_id === branch.id);
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
