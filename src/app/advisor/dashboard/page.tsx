import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDashboardData } from "@/lib/dashboard/kpis";
import { getCachedClaimSide } from "@/lib/dashboard/cache";
import { displayFont } from "@/components/dashboard/font";
import { resolveMonthRange } from "@/lib/dashboard/range";
import { KpiDashboard } from "@/components/dashboard/kpi-dashboard";
import { parseTab } from "@/components/dashboard/tabs";
import { getSupportLeadTimes } from "@/lib/dashboard/support";

/**
 * The service advisor: his branch's KPI dashboard (read only), as the warranty admin sees it. The data is read with
 * the service role, scoped here to his own branch only (database policies are written for the warranty admin).
 */
export default async function AdvisorDashboardPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; tab?: string }> }) {
  const user = await requireRole("service_advisor");
  const params = await searchParams;
  const { from, to, clamped } = resolveMonthRange(params);
  const supabase = await createClient();
  const { data: branch } = await supabase.from("self_audit_branches").select("id, name").eq("id", user.branch_id ?? "00000000-0000-0000-0000-000000000000").maybeSingle();
  const scopeBranches = branch ? [branch] : [];

  const support = getSupportLeadTimes(scopeBranches.map((b) => b.id), from, to);
  support.catch(() => {});
  const data = await getDashboardData(createAdminClient(), { branches: scopeBranches, from, to }, getCachedClaimSide(scopeBranches, from, to));

  return (
    <div className={`${displayFont.variable} relative left-1/2 w-[min(96rem,calc(100vw-var(--sidebar-w,0px)-2rem))] -translate-x-1/2`}>
      <KpiDashboard
        data={data}
        tab={parseTab(params.tab === "tasks" ? "overview" : params.tab)}
        basePath="/advisor/dashboard"
        from={from}
        to={to}
        isOfficer={false}
        allBranches={scopeBranches}
        selectedBranchIds={[]}
        scopeBranches={scopeBranches}
        rangeClamped={clamped}
        tasks={{ tasks: [], branchEmails: {} }}
        support={support}
      />
    </div>
  );
}
