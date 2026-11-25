import "server-only";
import { redirect } from "next/navigation";
import { requireAnyRole } from "@/lib/auth";

/** The workshop's courtesy car pages: only for an account given courtesy car access (Branches & Users > Edit). */
export async function requireWorkshopCourtesy() {
  const user = await requireAnyRole(["workshop_supervisor", "team_leader"]);
  if (!user.courtesy_access) redirect("/workshop");
  return user;
}
