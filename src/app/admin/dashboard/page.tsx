import { createClient } from "@/lib/supabase/server";
import { getDashboardData } from "@/lib/dashboard/kpis";
import { getCachedClaimSide, getCachedTrends } from "@/lib/dashboard/cache";
import { displayFont } from "@/components/dashboard/font";
import { resolveMonthRange } from "@/lib/dashboard/range";
import { KpiDashboard } from "@/components/dashboard/kpi-dashboard";
import { parseTab } from "@/components/dashboard/tabs";

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string | string[]; from?: string; to?: string; tab?: string }>;
}) {
  const params = await searchParams;
  const { from, to, clamped } = resolveMonthRange(params);
  const supabase = await createClient();

  const { data: branches } = await supabase.from("self_audit_branches").select("id, name, active").order("name");
  const allBranches = (branches ?? []).map(({ id, name }) => ({ id, name }));

  const selectedBranchIds = new Set(params.branch ? (Array.isArray(params.branch) ? params.branch : [params.branch]) : []);
  // No selection = every active branch (inactive ones only when picked explicitly).
  const scopeBranches =
    selectedBranchIds.size > 0
      ? allBranches.filter((b) => selectedBranchIds.has(b.id))
      : (branches ?? []).filter((b) => b.active).map(({ id, name }) => ({ id, name }));

  // Not awaited: the trends tab streams in once ready, so the rest of the
  // dashboard isn't held up by the 7-month comparison.
  const trends = getCachedTrends(scopeBranches, from, to);
  const data = await getDashboardData(supabase, { branches: scopeBranches, from, to }, getCachedClaimSide(scopeBranches, from, to));

  return (
    <div className={`${displayFont.variable} relative left-1/2 w-[min(96rem,calc(100vw-2rem))] -translate-x-1/2`}>
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
      />
    </div>
  );
}
