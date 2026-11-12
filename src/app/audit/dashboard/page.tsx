import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDashboardData } from "@/lib/dashboard/kpis";
import { getCachedClaimSide } from "@/lib/dashboard/cache";
import { displayFont } from "@/components/dashboard/font";
import { resolveMonthRange } from "@/lib/dashboard/range";
import { KpiDashboard } from "@/components/dashboard/kpi-dashboard";
import { parseTab } from "@/components/dashboard/tabs";
import { getQcAnalysis } from "@/lib/qc/server";
import { getSupportLeadTimes } from "@/lib/dashboard/support";
import { getRejectedClaimsStats } from "@/lib/dashboard/rejected";
import { getRejectedClaimsAccess } from "@/lib/rejected-claims-server";
import { Suspense } from "react";
import { branchHasSubDealer } from "@/lib/dashboard/sub-dealer-access";
import { AuditsPanel } from "@/components/dashboard/audits-panel";

export const maxDuration = 60;

export default async function BranchDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; tab?: string }>;
}) {
  const user = await requireRole("branch_admin");
  const params = await searchParams;
  const { from, to, clamped } = resolveMonthRange(params);
  const supabase = await createClient();

  // A branch admin only ever sees their own branch - RLS enforces the same.
  const { data: branch } = await supabase
    .from("self_audit_branches")
    .select("id, name")
    .eq("id", user.branch_id!)
    .single();
  const scopeBranches = branch ? [branch] : [];

  const support = getSupportLeadTimes(scopeBranches.map((b) => b.id), from, to);
  support.catch(() => {});
  // The diary's numbers only once the Rejected Claims Diary is open for this branch admin.
  // A service manager (view only, own branch) gets the slimmer Warranty Overview + Audits view, without the rejected-claims diary.
  const manager = user.managerKind === "service_manager";
  const rejected = !manager && (await getRejectedClaimsAccess(user)) === "full" ? getRejectedClaimsStats(scopeBranches.map((x) => x.id), to) : undefined;
  rejected?.catch(() => {});
  // Quality control is not part of the manager's view.
  const quality = manager ? undefined : getQcAnalysis(user, { from, to });
  quality?.catch(() => {});
  const data = await getDashboardData(supabase, { branches: scopeBranches, from, to }, getCachedClaimSide(scopeBranches, from, to));

  return (
    <div className={`${displayFont.variable} relative left-1/2 w-[min(96rem,calc(100vw-var(--sidebar-w,0px)-2rem))] -translate-x-1/2`}>
      <KpiDashboard
        data={data}
        tab={parseTab(params.tab, false, manager)}
        basePath="/audit/dashboard"
        from={from}
        to={to}
        isOfficer={false}
        allBranches={scopeBranches}
        selectedBranchIds={[]}
        scopeBranches={scopeBranches}
        rangeClamped={clamped}
        quality={quality}
        qualityRecordsHref="/audit/quality-control"
        support={support}
        rejected={rejected}
        manager={manager}
        hasSubDealer={manager && (await branchHasSubDealer(supabase, user.branch_id))}
        auditsPanel={
          manager ? (
            <Suspense fallback={null}>
              <AuditsPanel />
            </Suspense>
          ) : undefined
        }
      />
    </div>
  );
}
