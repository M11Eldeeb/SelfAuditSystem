import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database, UserRole } from "@/lib/supabase/types";

/**
 * `viewOnly`: this user is looking at pages of another role without being allowed to change anything - a service
 * manager on the branch admin's pages (own branch), or a `view_all` user (e.g. a technical team member) on the warranty
 * officer's pages, or a manager (every branch) on the warranty officer's pages. The role is then the role whose pages are
 * shown, so the pages render exactly as for that role.
 * `managerKind`: set for the manager accounts. The manager (every branch) and the service manager (his branch) get the
 * slimmer manager view of the dashboard and the menu; the national manager (every branch) gets the officer's dashboard
 * with a shorter menu.
 */
export type CurrentUser = Database["public"]["Tables"]["self_audit_users"]["Row"] & { viewOnly?: boolean; managerKind?: "manager" | "service_manager" | "national_manager" };

/**
 * Returns the signed-in user's app profile (role, branch), or null if not
 * signed in. Wrapped in React's per-request cache: when a Server Action
 * calls redirect(), Next renders the destination page within the SAME
 * request, and that page calls requireRole() again immediately - without
 * this cache, that means verifying the same session (an auth.getUser() call
 * plus a profile lookup) twice back-to-back on every Save & Next.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  // The token's signature and expiry are checked here without a call to the auth server (the proxy has just refreshed it).
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub ?? (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return null;

  const { data: profile } = await supabase
    .from("self_audit_users")
    .select("*")
    .eq("id", userId)
    .single();

  return profile ?? null;
});

/** Each role's landing page: its Home (widgets and the figures of its own work, components/home). */
export function homePathFor(role: UserRole | null | undefined): string {
  if (role === "officer" || role === "manager" || role === "national_manager") return "/admin/home";
  if (role === "data_analyst") return "/analyst/home";
  if (role === "technical") return "/technical/home";
  if (role === "technician") return "/technician/home";
  if (role === "claims_reviewer") return "/reviewer/home";
  if (role === "service_advisor") return "/advisor/home";
  if (role === "quality_controller") return "/qc/home";
  if (role === "queue_user") return "/queue/home";
  if (role === "workshop_supervisor" || role === "team_leader") return "/workshop/home";
  return "/audit/home"; // branch admin and service manager
}

/** The user as a view-only copy of `role`, when they may look at that role's pages (else null). */
function viewAs(user: CurrentUser, role: UserRole): CurrentUser | null {
  if (role === "branch_admin" && user.role === "service_manager") return { ...user, role: "branch_admin", viewOnly: true, managerKind: "service_manager" };
  if (role === "officer" && user.role === "manager") return { ...user, role: "officer", viewOnly: true, managerKind: "manager" };
  if (role === "officer" && user.role === "national_manager") return { ...user, role: "officer", viewOnly: true, managerKind: "national_manager" };
  if (role === "officer" && user.view_all && user.role !== "officer") return { ...user, role: "officer", viewOnly: true };
  return null;
}

/**
 * A view-only user reached a Server Action that changes something: nothing is done - they are sent back to the page
 * they were on, which shows the "view only" notice.
 */
async function refuseChange(): Promise<never> {
  const h = await headers();
  let back = "/";
  try {
    const ref = h.get("referer");
    if (ref) {
      const u = new URL(ref);
      u.searchParams.set("viewOnly", "1");
      back = `${u.pathname}${u.search}`;
    }
  } catch {
    // keep "/"
  }
  redirect(back);
}

const inServerAction = async () => (await headers()).has("next-action");

/** TEMPORARY (QC testing): accounts that may also act as a quality controller. */
const TEMP_QC_TESTERS = new Set(["092bf5b6-a540-4384-aac1-c3050c8de0ca"]); // Mostafa Eldeeb (officer)
const TEMP_QC_BRANCH = "12d47c61-e69f-4854-adfe-2a2196eea1ef"; // Jeddah Heraa

async function resolve(roles: UserRole[], allowViewOnlyActions: boolean): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // A password someone else chose (e.g. a shared one for an imported team) is changed before anything else.
  if (user.must_change_password) redirect("/account/password?first=1");
  if (roles.includes(user.role)) return user;
  // TEMPORARY (QC testing): the warranty officer's own account may use the quality controller's pages and submit QCs, as a
  // quality controller of Jeddah Heraa. Remove this block, TEMP_QC_TESTERS and TEMP_QC_BRANCH when the testing is over.
  if (roles.includes("quality_controller") && TEMP_QC_TESTERS.has(user.id)) return { ...user, role: "quality_controller", branch_id: TEMP_QC_BRANCH };
  for (const role of roles) {
    const view = viewAs(user, role);
    if (view) {
      if (!allowViewOnlyActions && (await inServerAction())) await refuseChange();
      return view;
    }
  }
  redirect(homePathFor(user.role));
}

/**
 * Any signed-in user, whatever the role (and view-only accounts too): for what every role may do, e.g. send feedback to
 * the warranty team. The real role is kept (no officer / branch admin "view" copy).
 */
export async function requireAnyUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.must_change_password) redirect("/account/password?first=1");
  return user;
}

/** Like requireRole, for pages two account types share (the workshop supervisor and the team leader). */
export async function requireAnyRole(roles: UserRole[]): Promise<CurrentUser> {
  return resolve(roles, false);
}

/** Redirects to /login if not signed in, or to the user's own home if the role doesn't match. */
export async function requireRole(role: UserRole): Promise<CurrentUser> {
  return resolve([role], false);
}

/**
 * For Server Actions that only READ (load a chart, a list, an export): view-only users may run them. Every other
 * action uses requireRole / requireAnyRole, which refuse view-only users.
 */
export async function requireViewer(role: UserRole): Promise<CurrentUser> {
  return resolve([role], true);
}
export async function requireAnyViewer(roles: UserRole[]): Promise<CurrentUser> {
  return resolve(roles, true);
}
