import { createClient } from "@/lib/supabase/server";
import { PODIUM_STANDING_CC, WARRANTY_HEAD_EMAIL } from "@/lib/mail/contacts";
import { PodiumCongrats } from "@/components/podium-congrats";
import { AuditFolders } from "@/components/audits/audit-folders";
import { StandingsList } from "@/components/standings-list";
import { computeCurrentCycleStandings, computeOverallStandings } from "@/lib/standings";

// Standing recipients for the monthly podium congratulations email, on top
// of every branch admin (fetched fresh below - branches/admins change).
const PODIUM_EMAIL_CC = [
  WARRANTY_HEAD_EMAIL,
  "ahmad.hamdani@jiadmotors.com", // fellow warranty officer
  ...PODIUM_STANDING_CC,
];

export default async function AuditsPage() {
  const supabase = await createClient();

  const [
    { data: results },
    { data: branches },
    { data: cycles },
    { data: branchAdmins },
    { data: internalAudits },
    { data: historicalInternalAudits },
    { data: historicalSelfAudits },
  ] = await Promise.all([
    supabase.from("self_audit_audit_results").select("*"),
    supabase.from("self_audit_branches").select("id, name, active").order("name"),
    supabase.from("self_audit_audit_cycles").select("id, cycle_month, status"),
    supabase.from("self_audit_users").select("email").eq("role", "branch_admin"),
    supabase.rpc("get_finalized_internal_audit_scores"),
    supabase.rpc("get_historical_internal_audit_scores"),
    supabase.rpc("get_historical_self_audit_scores"),
  ]);

  // Historical results count toward the standings too, so they alone are enough to show the page.
  const hasAnyScores = [results, internalAudits, historicalInternalAudits, historicalSelfAudits].some((r) => (r?.length ?? 0) > 0);
  if (!hasAnyScores) {
    return (
      <div className="space-y-8">
        <AuditsHeader />
        <AuditFolders />
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-neutral-900">Overview</h2>
          <p className="text-sm text-neutral-600">
            No audit cycles have been finalized yet. Open the Self Audit folder to generate a cycle and review branch
            submissions.
          </p>
        </section>
      </div>
    );
  }

  const allBranches = branches ?? [];
  const safeResults = results ?? [];

  // The podium is always the current cycle only; the standings are always all-time.
  // Besides this system's own finalized self-audit cycles, the standings count
  // internal audits (live and historical) and historical self audits.
  const extraScores = [...(internalAudits ?? []), ...(historicalInternalAudits ?? []), ...(historicalSelfAudits ?? [])];
  // Cycles are never auto-closed, so an older cycle can still be open next to
  // the new one - the podium must follow the newest open cycle, not whichever
  // row the query happened to return first.
  const openCycle =
    (cycles ?? [])
      .filter((c) => c.status === "open")
      .sort((a, b) => b.cycle_month.localeCompare(a.cycle_month))[0] ?? null;
  const podiumStandings = computeCurrentCycleStandings(safeResults, allBranches, openCycle?.id ?? null);
  // Closed (inactive) branches keep their history but are not ranked.
  const rankedBranches = allBranches.filter((b) => b.active);
  const overallStandings = computeOverallStandings(safeResults, rankedBranches, extraScores);
  const cycleLabel = openCycle
    ? new Date(`${openCycle.cycle_month}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : "";
  const podiumEmailTo = (branchAdmins ?? []).map((u) => u.email).filter((e): e is string => !!e);

  return (
    <div className="space-y-8">
      <AuditsHeader />
      <AuditFolders />

      <div>
        <h2 className="text-lg font-semibold text-neutral-900">Overview</h2>
        <p className="text-sm text-neutral-600">Branch performance across finalized audit cycles.</p>
      </div>

      {(podiumStandings.length > 0 || overallStandings.length > 0) ? (
        <section className="space-y-6">
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-neutral-900">Top performers</h2>
            <p className="text-sm text-neutral-600">Current cycle.</p>
            {podiumStandings.length > 0 ? (
              <PodiumCongrats
                entries={podiumStandings}
                cycleLabel={cycleLabel}
                toEmails={podiumEmailTo}
                ccEmails={PODIUM_EMAIL_CC}
              />
            ) : (
              <p className="text-sm text-neutral-500">No branch has been finalized for the current cycle yet.</p>
            )}
          </div>
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-neutral-900">Standings</h2>
            <p className="text-sm text-neutral-600">
              Every branch&apos;s average across all finalized self-audit cycles and internal audits,
              including historical results, best to worst. Difference shown is vs. the top performer.
            </p>
            <StandingsList entries={overallStandings} />
          </div>
        </section>
      ) : (
        <p className="text-sm text-neutral-500">No finalized results yet.</p>
      )}
    </div>
  );
}

function AuditsHeader() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Audits</h1>
      <p className="text-sm text-neutral-600">Self audits, internal audits and their results in one place.</p>
    </div>
  );
}
