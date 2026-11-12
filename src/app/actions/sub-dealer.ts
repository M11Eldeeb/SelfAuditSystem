"use server";

import { requireAnyViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadSubDealerDashboard, type SubDealerDashboard } from "@/lib/dashboard/sub-dealer";
import { branchHasSubDealer } from "@/lib/dashboard/sub-dealer-access";

/**
 * The Sub-dealer Dashboard tab of the manager's dashboard, loaded when the tab is opened. A manager sees all of it, a
 * service manager only when his own branch has sub-dealer work orders (Heraa); an officer always.
 */
export async function getSubDealerForDashboard(): Promise<SubDealerDashboard | { status: "denied" }> {
  const user = await requireAnyViewer(["officer", "branch_admin"]);
  if (user.role === "branch_admin" && !(user.managerKind === "service_manager" && (await branchHasSubDealer(await createClient(), user.branch_id)))) return { status: "denied" };
  return loadSubDealerDashboard();
}
