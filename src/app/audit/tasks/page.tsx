import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getTasks } from "@/lib/tasks";
import { TaskTracker } from "@/components/tasks/task-list";

/** The branch's task tracking (opened from the notification bell - it used to be a dashboard tab). */
export default async function BranchTasksPage() {
  const user = await requireRole("branch_admin");
  const data = await getTasks(await createClient(), user);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold tracking-tight text-neutral-900">Tasks</h1>
      <TaskTracker data={data} isOfficer={false} />
    </div>
  );
}
