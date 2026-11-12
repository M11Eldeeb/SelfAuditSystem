import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { branchHasSubDealer } from "@/lib/dashboard/sub-dealer-access";
import { SubDealerPage } from "@/components/dashboard/sub-dealer-page";

export const maxDuration = 60;

/** A service manager sees the sub-dealer analytics only when his own branch has sub-dealer work orders (Heraa). */
export default async function BranchSubDealerPage() {
  const user = await requireRole("branch_admin");
  if (!(await branchHasSubDealer(await createClient(), user.branch_id))) redirect("/audit/dashboard");
  return <SubDealerPage managerView />;
}
