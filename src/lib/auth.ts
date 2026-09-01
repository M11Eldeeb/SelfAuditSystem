import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

export type CurrentUser = Database["public"]["Tables"]["self_audit_users"]["Row"];

/** Returns the signed-in user's app profile (role, branch), or null if not signed in. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
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
}

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
