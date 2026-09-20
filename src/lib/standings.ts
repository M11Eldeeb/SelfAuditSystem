import type { Database } from "./supabase/types";

type Result = Database["public"]["Tables"]["self_audit_audit_results"]["Row"];

export type StandingsEntry = {
  branchId: string;
  name: string;
  avg: number;
  cyclesUsed: number;
};

type ScoredRow = { branch_id: string; score_pct: number };

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

/**
 * Standings: each branch's average across every finalized self-audit cycle
 * on file, plus every finalized internal audit for that branch (each one
 * counted the same as a self-audit cycle's score, not just a recent
 * window) - the podium stays self-audit-only (computeCurrentCycleStandings),
 * this is the one place internal audit results feed in.
 */
export function computeOverallStandings(
  results: Result[],
  branches: { id: string; name: string }[],
  internalAuditResults: ScoredRow[] = []
): StandingsEntry[] {
  const entries: StandingsEntry[] = [];
  for (const branch of branches) {
    const branchScores = [
      ...results.filter((r) => r.branch_id === branch.id).map((r) => r.score_pct),
      ...internalAuditResults.filter((r) => r.branch_id === branch.id).map((r) => r.score_pct),
    ];
    if (branchScores.length === 0) continue;
    const avg = branchScores.reduce((sum, s) => sum + s, 0) / branchScores.length;
    entries.push({
      branchId: branch.id,
      name: branch.name,
      avg: Math.round(avg * 10) / 10,
      cyclesUsed: branchScores.length,
    });
  }

  return entries.sort((a, b) => b.avg - a.avg);
}
