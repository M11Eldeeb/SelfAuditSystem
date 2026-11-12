import { createClient } from "@/lib/supabase/server";
import { computeCurrentCycleStandings, computeOverallStandings } from "@/lib/standings";
import { StandingsList } from "@/components/standings-list";
import { Panel } from "@/components/dashboard/ui";
import { MonthPodium } from "./month-podium";

/** The manager's Audits tab: the podium of each month (pick the month) and the all-time standings. */
export async function AuditsPanel() {
  const supabase = await createClient();
  const [{ data: results }, { data: branches }, { data: cycles }, { data: internalAudits }, { data: historicalInternal }, { data: historicalSelf }] = await Promise.all([
    supabase.from("self_audit_audit_results").select("*"),
    supabase.from("self_audit_branches").select("id, name, active").order("name"),
    supabase.from("self_audit_audit_cycles").select("id, cycle_month").order("cycle_month", { ascending: false }),
    supabase.rpc("get_finalized_internal_audit_scores"),
    supabase.rpc("get_historical_internal_audit_scores"),
    supabase.rpc("get_historical_self_audit_scores"),
  ]);

  const allBranches = (branches ?? []).map(({ id, name }) => ({ id, name }));
  const ranked = (branches ?? []).filter((b) => b.active).map(({ id, name }) => ({ id, name }));
  const safeResults = results ?? [];

  // One podium per cycle month, newest first; a month nobody was finalized in has no podium.
  const months = (cycles ?? [])
    .map((c) => ({
      id: c.id,
      label: new Date(`${c.cycle_month}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
      entries: computeCurrentCycleStandings(safeResults, allBranches, c.id),
    }))
    .filter((m) => m.entries.length > 0);

  const standings = computeOverallStandings(safeResults, ranked, [...(internalAudits ?? []), ...(historicalInternal ?? []), ...(historicalSelf ?? [])]);

  return (
    <div className="space-y-5">
      <Panel title="Top performers" subtitle="The podium of the month - pick another month to see its podium">
        {months.length > 0 ? <MonthPodium months={months} /> : <p className="py-6 text-center text-sm text-neutral-500">No branch has been finalized yet.</p>}
      </Panel>
      <Panel title="Standings" subtitle="Every branch's average across all finalized self-audit cycles and internal audits, including historical results, best to worst">
        {standings.length > 0 ? <StandingsList entries={standings} /> : <p className="py-6 text-center text-sm text-neutral-500">No finalized results yet.</p>}
      </Panel>
    </div>
  );
}
