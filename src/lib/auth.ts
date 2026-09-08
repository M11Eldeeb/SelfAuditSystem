import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

export type CurrentUser = Database["public"]["Tables"]["self_audit_users"]["Row"];

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

/** Redirects to /login if not signed in, or to the other role's home if the role doesn't match. */
export async function requireRole(role: "officer" | "branch_admin"): Promise<CurrentUser> {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (user.role !== role) {
    redirect(user.role === "officer" ? "/admin" : "/audit");
  }

  return user;
}
