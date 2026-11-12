import { createClient } from "@/lib/supabase/server";
import { getDashboardData } from "@/lib/dashboard/kpis";
import { getCachedClaimSide, getCachedForecast, getCachedTrends } from "@/lib/dashboard/cache";
import { displayFont } from "@/components/dashboard/font";
import { resolveMonthRange } from "@/lib/dashboard/range";
import { KpiDashboard } from "@/components/dashboard/kpi-dashboard";
import { parseTab } from "@/components/dashboard/tabs";
import { getQcAnalysis } from "@/lib/qc/server";
import { getSupportLeadTimes } from "@/lib/dashboard/support";
import { getRejectedClaimsStats } from "@/lib/dashboard/rejected";
import { loadPriorApprovals } from "@/lib/dashboard/prior-approvals";
import { requireRole } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuditsPanel } from "@/components/dashboard/audits-panel";

// The Warranty Invoicing refresh reads the report e-mail and its ~11 MB Excel file.
export const maxDuration = 60;

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string | string[]; from?: string; to?: string; tab?: string; sheets?: string; detail?: string }>;
}) {
  const user = await requireRole("officer");
  // A manager (view only, every branch) gets the slimmer Warranty Overview + Audits view: no trends, forecast, prior approvals or rejected-claims diary.
  const manager = user.managerKind === "manager";
  // The national manager gets the officer's dashboard (view only) with an Audits tab and a rejected-claims card.
  const national = user.managerKind === "national_manager";
  const params = await searchParams;
  // Reconciliation moved to its own page in the sidebar.
  if (params.tab === "reconciliation") redirect("/admin/reconciliation");
  const { from, to, clamped } = resolveMonthRange(params);
  const supabase = await createClient();

  const { data: branches } = await supabase.from("self_audit_branches").select("id, name, active, code").order("name");
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
  const trends = manager ? undefined : claimSide.then(() => getCachedTrends(scopeBranches, from, to));
  // Rejections surface in the trends tab (its error boundary), not here.
  trends?.catch(() => {});
  // Same idea for the settlement forecast (Claims & Financials), after trends.
  const forecast = trends ? trends.then(() => getCachedForecast(), () => getCachedForecast()) : undefined;
  forecast?.catch(() => {});
  const support = manager ? undefined : getSupportLeadTimes(scopeBranches.map((b) => b.id), from, to);
  support?.catch(() => {});
  const rejected = manager || national ? undefined : getRejectedClaimsStats(scopeBranches.map((b) => b.id), to);
  rejected?.catch(() => {});
  // The Prior Approvals tab streams in like the others (switching tabs does not reload the page). The sheet read is
  // cached for two minutes and never rejects - a problem shows inside that tab only.
  const prior = manager ? undefined : loadPriorApprovals((branches ?? []).map((b) => ({ name: b.name, code: b.code })));
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
  // Quality control is not part of the manager's view.
  const quality = manager ? undefined : getQcAnalysis(user, { from, to, branchIds: selectedBranchIds.size ? scopeBranches.map((b) => b.id) : undefined });
  quality?.catch(() => {});
  const data = await getDashboardData(supabase, { branches: scopeBranches, from, to }, claimSide);

  return (
    <div className={`${displayFont.variable} relative left-1/2 w-[min(96rem,calc(100vw-var(--sidebar-w,0px)-2rem))] -translate-x-1/2`}>
      <KpiDashboard
        // The national manager's menu switches between two dashboards on this one page: start afresh on each.
        key={national && params.tab === "quality" ? "quality" : "warranty"}
        data={data}
        tab={parseTab(params.tab, true, manager, national)}
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
        quality={quality}
        qualityRecordsHref="/admin/quality-control"
        manager={manager}
        national={national}
        hasSubDealer={manager}
        auditsPanel={
          manager || national ? (
            <Suspense fallback={null}>
              <AuditsPanel />
            </Suspense>
          ) : undefined
        }
      />
    </div>
  );
}
