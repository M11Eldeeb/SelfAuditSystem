import type { CurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getTasks, type Task } from "@/lib/tasks";
import { TaskNotifier } from "./task-notifier";

/** Loaded in a Suspense boundary by the layouts so it never holds up the page. */
export async function TaskNotifierServer({ user }: { user: CurrentUser }) {
  let tasks: Task[] = [];
  try {
    tasks = (await getTasks(await createClient(), user)).tasks;
  } catch {
    // A slow or failed task lookup must never break the page.
    return null;
  }
  const isOfficer = user.role === "officer";
  return <TaskNotifier tasks={tasks} isOfficer={isOfficer} tasksHref={isOfficer ? "/admin/dashboard?tab=tasks" : "/audit/dashboard?tab=tasks"} />;
}
