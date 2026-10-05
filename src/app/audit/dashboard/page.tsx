import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDashboardData } from "@/lib/dashboard/kpis";
import { getCachedClaimSide } from "@/lib/dashboard/cache";
import { displayFont } from "@/components/dashboard/font";
import { resolveMonthRange } from "@/lib/dashboard/range";
import { KpiDashboard } from "@/components/dashboard/kpi-dashboard";
import { parseTab } from "@/components/dashboard/tabs";

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

  const data = await getDashboardData(supabase, { branches: scopeBranches, from, to }, getCachedClaimSide(scopeBranches, from, to));

  return (
    <div className={`${displayFont.variable} relative left-1/2 w-[min(96rem,calc(100vw-2rem))] -translate-x-1/2`}>
      <KpiDashboard
        data={data}
        tab={parseTab(params.tab)}
        basePath="/audit/dashboard"
        from={from}
        to={to}
        isOfficer={false}
        allBranches={scopeBranches}
        selectedBranchIds={[]}
        scopeBranches={scopeBranches}
        rangeClamped={clamped}
      />
    </div>
  );
}
