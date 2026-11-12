"use server";

import { requireAnyUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanLayout, type NavLayout } from "@/lib/nav-layout";

/**
 * Saves the menu the signed-in person arranged (the order of the entries and the folders they made). A personal
 * setting: every account may save it, view-only accounts too. `null` brings back the standard menu.
 */
export async function saveNavLayout(layout: NavLayout | null): Promise<{ error?: string }> {
  const user = await requireAnyUser();
  const clean = layout === null ? null : cleanLayout(layout);
  if (layout !== null && !clean) return { error: "Could not save the menu." };
  const { error } = await createAdminClient().from("self_audit_users").update({ nav_layout: clean }).eq("id", user.id);
  return error ? { error: "Could not save the menu." } : {};
}
