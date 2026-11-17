import { requireRole } from "@/lib/auth";
import { SubDealerPage } from "@/components/dashboard/sub-dealer-page";

export const maxDuration = 60;

/** The data analyst's only page: the full Sub-Dealer Analytics, read only (no Google connect button). */
export default async function AnalystSubDealerPage() {
  await requireRole("data_analyst");
  return <SubDealerPage managerView={false} viewOnly />;
}
