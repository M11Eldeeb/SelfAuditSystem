import "server-only";
import { getCurrentUser, requireRole, type CurrentUser } from "@/lib/auth";

/**
 * The technician pages and actions: a technician, or anyone given "submit technician claims" on his account (e.g. a
 * branch's warranty admin) - he submits for his own branch, as himself.
 */
export async function requireTechnician(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user && user.role !== "technician" && user.tech_submit && user.branch_id && !user.must_change_password) return user;
  return requireRole("technician");
}
