import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getQueueAccess } from "@/lib/queue/server";
import { TeamTable, type TeamMember } from "@/components/queue/team-table";

/** The after-sales team list (from the old queue app): names, titles, branches and contacts. */
export default async function QueueTeamPage() {
  const a = await getQueueAccess();
  if (!a) redirect("/");
  const admin = createAdminClient();
  const [{ data: people }, { data: branches }] = await Promise.all([
    admin.from("self_audit_queue_employees").select("id, name, title, city, branch_id, branch_name, phone, email").order("name"),
    admin.from("self_audit_branches").select("id, name").eq("active", true).order("name"),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Team</h1>
      <TeamTable people={(people ?? []) as TeamMember[]} branches={branches ?? []} canEdit={a.admin && !a.user.viewOnly} />
    </div>
  );
}
