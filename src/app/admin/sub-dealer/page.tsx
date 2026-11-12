import { requireRole } from "@/lib/auth";
import { SubDealerPage } from "@/components/dashboard/sub-dealer-page";

export const maxDuration = 60;

/** Officers (and managers, view only): the sub-dealer's live Google Sheet next to what the dealer got on the claims batch for the same work orders. */
export default async function SubDealerDashboardPage() {
  const user = await requireRole("officer");
  return <SubDealerPage managerView={user.managerKind === "manager"} viewOnly={!!user.managerKind} dashboardName={user.managerKind === "national_manager"} />;
}
