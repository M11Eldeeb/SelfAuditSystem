import { isOnOrAfterReconStart } from "@/lib/dashboard/recon-constants";
import { createClient } from "@/lib/supabase/server";
import { getDashboardData } from "@/lib/dashboard/kpis";
import { getCachedClaimSide, getCachedForecast, getCachedTrends } from "@/lib/dashboard/cache";
import { displayFont } from "@/components/dashboard/font";
import { resolveMonthRange } from "@/lib/dashboard/range";
import { KpiDashboard } from "@/components/dashboard/kpi-dashboard";
import { parseTab } from "@/components/dashboard/tabs";
import { getTasks } from "@/lib/tasks";
import { getSupportLeadTimes } from "@/lib/dashboard/support";
import { getRejectedClaimsStats } from "@/lib/dashboard/rejected";
import { loadPriorApprovals } from "@/lib/dashboard/prior-approvals";
import { requireRole } from "@/lib/auth";

// The Warranty Invoicing refresh reads the report e-mail and its ~11 MB Excel file.
export const maxDuration = 60;

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string | string[]; from?: string; to?: string; tab?: string; view?: string; sheets?: string; detail?: string }>;
}) {
  const user = await requireRole("officer");
  const params = await searchParams;
  const { from, to, clamped } = resolveMonthRange(params);
  const supabase = await createClient();

  const [{ data: branches }, { data: orders }] = await Promise.all([
    supabase.from("self_audit_branches").select("id, name, active, code").order("name"),
    supabase.rpc("get_settlement_orders"),
  ]);
  const allBranches = (branches ?? []).map(({ id, name }) => ({ id, name }));

  const selectedBranchIds = new Set(params.branch ? (Array.isArray(params.branch) ? params.branch : [params.branch]) : []);
  // No selection = every active branch (inactive ones only when picked explicitly).
  const scopeBranches =
    selectedBranchIds.size > 0
      ? allBranches.filter((b) => selectedBranchIds.has(b.id))
      : (branches ?? []).filter((b) => b.active).map(({ id, name }) => ({ id, name }));

  const claimSide = getCachedClaimSide(scopeBranches, from, to);
  // Not awaited: the trends tab streams in once ready, so the rest of the
  // dashboard isn't held up by the 7-month comparison. Started only after the
  // claims side is done, so the two don't hit the database at the same time.
  const trends = claimSide.then(() => getCachedTrends(scopeBranches, from, to));
  // Rejections surface in the trends tab (its error boundary), not here.
  trends.catch(() => {});
  // Same idea for the settlement forecast (Claims & Financials), after trends.
  const forecast = trends.then(() => getCachedForecast(), () => getCachedForecast());
  forecast.catch(() => {});
  const support = getSupportLeadTimes(scopeBranches.map((b) => b.id), from, to);
  support.catch(() => {});
  const rejected = getRejectedClaimsStats(scopeBranches.map((b) => b.id), to);
  rejected.catch(() => {});
  // The Prior Approvals tab streams in like the others (switching tabs does not reload the page). The sheet read is
  // cached for two minutes and never rejects - a problem shows inside that tab only.
  const prior = loadPriorApprovals((branches ?? []).map((b) => ({ name: b.name, code: b.code })));
  const sheetsNotice =
    params.sheets === "failed"
      ? `Google Sheets could not be connected. ${params.detail ?? ""}`.trim()
      : params.sheets === "cancelled"
        ? "The Google sign-in was cancelled."
        : params.sheets === "wrong-account"
          ? "Connect with a company (jiadmotors.com) Google account."
          : params.sheets === "no-refresh-token"
            ? "Google did not return a long-lived access - try connecting again."
            : params.sheets === "bad-state" || params.sheets === "not-configured"
              ? "Google sign-in is not set up for this link - try connecting again."
              : undefined;
  const tasksPromise = getTasks(supabase, user);
  const data = await getDashboardData(supabase, { branches: scopeBranches, from, to }, claimSide);

  return (
    <div className={`${displayFont.variable} relative left-1/2 w-[min(96rem,calc(100vw-var(--sidebar-w,0px)-2rem))] -translate-x-1/2`}>
      <KpiDashboard
        data={data}
        tab={parseTab(params.tab, true)}
        basePath="/admin/dashboard"
        from={from}
        to={to}
        isOfficer
        allBranches={allBranches}
        selectedBranchIds={[...selectedBranchIds]}
        scopeBranches={scopeBranches}
        rangeClamped={clamped}
        trends={trends}
        forecast={forecast}
        support={support}
        rejected={rejected}
        prior={prior}
        sheetsNotice={sheetsNotice}
        initialWarrantyView={params.view === "warranty" || params.tab === "prior" || params.sheets ? "prior" : "room"}
        tasks={await tasksPromise}
        settlementOrders={(orders ?? []).map((o) => o.settlement_order).filter(isOnOrAfterReconStart)}
      />
    </div>
  );
}
