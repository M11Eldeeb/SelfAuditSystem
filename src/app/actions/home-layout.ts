"use server";

import { requireAnyUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanHomeLayout, type HomeLayout } from "@/lib/home/layout";

/**
 * Saves the Home page the signed-in person arranged (their widgets, notes, to-dos, calendar notes). A personal setting:
 * every account may save it, view-only accounts too. `null` brings back the standard Home.
 */
export async function saveHomeLayout(layout: HomeLayout | null): Promise<{ error?: string }> {
  const user = await requireAnyUser();
  const clean = layout === null ? null : cleanHomeLayout(layout);
  if (layout !== null && !clean) return { error: "Too much to save - remove a widget or shorten a note." };
  const { error } = await createAdminClient().from("self_audit_users").update({ home_layout: clean }).eq("id", user.id);
  return error ? { error: "Could not save your Home page." } : {};
}
