import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database, UserRole } from "@/lib/supabase/types";

/**
 * `viewOnly`: this user is looking at pages of another role without being allowed to change anything - a service
 * manager on the branch admin's pages (own branch), or a `view_all` user (e.g. a technical team member) on the warranty
 * officer's pages. The role is then the role whose pages are shown, so the pages render exactly as for that role.
 */
export type CurrentUser = Database["public"]["Tables"]["self_audit_users"]["Row"] & { viewOnly?: boolean };

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
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return null;

  const { data: profile } = await supabase
    .from("self_audit_users")
    .select("*")
    .eq("id", authUser.id)
    .single();

  return profile ?? null;
});

/** Each role's landing page: the dashboard (finance has a single page). */
export function homePathFor(role: UserRole | null | undefined): string {
  if (role === "officer") return "/admin/dashboard";
  if (role === "finance") return "/finance";
  if (role === "technical") return "/technical/technical-inquiries";
  if (role === "technician") return "/technician";
  if (role === "workshop_supervisor" || role === "team_leader") return "/workshop/technical-inquiries";
  return "/audit/dashboard"; // branch admin and service manager
}

/** The user as a view-only copy of `role`, when they may look at that role's pages (else null). */
function viewAs(user: CurrentUser, role: UserRole): CurrentUser | null {
  if (role === "branch_admin" && user.role === "service_manager") return { ...user, role: "branch_admin", viewOnly: true };
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

async function resolve(roles: UserRole[], allowViewOnlyActions: boolean): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (roles.includes(user.role)) return user;
  for (const role of roles) {
    const view = viewAs(user, role);
    if (view) {
      if (!allowViewOnlyActions && (await inServerAction())) await refuseChange();
      return view;
    }
  }
  redirect(homePathFor(user.role));
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
