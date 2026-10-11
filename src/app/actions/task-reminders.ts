"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Logs that the officer sent a reminder email for these branch tasks, so the
 * next reminder becomes due REMINDER_EVERY_DAYS later.
 */
export async function logTaskReminders(branchId: string, taskKeys: string[]): Promise<{ error?: string }> {
  const officer = await requireRole("officer");
  if (!taskKeys.length) return {};
  const supabase = await createClient();
  const { error } = await supabase
    .from("self_audit_task_reminders")
    .insert(taskKeys.map((task_key) => ({ task_key, branch_id: branchId, sent_by: officer.id })));
  if (error) return { error: error.message };
  revalidatePath("/admin", "layout");
  return {};
}
