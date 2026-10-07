import { isOnOrAfterReconStart } from "@/lib/dashboard/recon-constants";
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

  const [{ data: branches }, { data: orders }] = await Promise.all([
    supabase.from("self_audit_branches").select("id, name, active").order("name"),
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
  const data = await getDashboardData(supabase, { branches: scopeBranches, from, to }, claimSide);

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
        settlementOrders={(orders ?? []).map((o) => o.settlement_order).filter(isOnOrAfterReconStart)}
      />
    </div>
  );
}
