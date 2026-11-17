import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { createAdminClient } from "@/lib/supabase/admin";
import { effectiveQueueRole, requireQueueAccess } from "@/lib/queue/server";
import { siteOrigin } from "@/lib/site-origin";
import { QueueAdmin, type AdminBranch, type AdminPerson, type AdminUser } from "@/components/queue/queue-admin";

/** Queue admin (warranty officers): branch codes and QR, the old queue app's people (accounts to create), and queue access on the portal's accounts. */
export default async function QueueAdminPage() {
  const a = await requireQueueAccess();
  if (!a.admin) redirect("/queue");
  const admin = createAdminClient();
  const [{ data: branches }, { data: users }, { data: people }, origin] = await Promise.all([
    admin.from("self_audit_branches").select("id, name, queue_code, name_ar, queue_status").eq("active", true).order("name"),
    admin.from("self_audit_users").select("id, full_name, email, role, branch_id, queue_role, job_title").order("full_name"),
    admin.from("self_audit_queue_import").select("id, name, title, branch_id, email, queue_role").order("name"),
    siteOrigin(),
  ]);
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const adminBranches: AdminBranch[] = await Promise.all(
    (branches ?? []).map(async (b) => {
      const joinUrl = b.queue_code ? `${origin}/q/${b.queue_code}` : null;
      return { ...b, joinUrl, qrSvg: joinUrl ? await QRCode.toString(joinUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) : null };
    })
  );
  // The old queue app's people: who has an account here already (same e-mail), with or without queue access.
  const byEmail = new Map((users ?? []).map((u) => [u.email.trim().toLowerCase(), u]));
  const adminPeople: AdminPerson[] = (people ?? []).map((p) => {
    const u = byEmail.get((p.email ?? "").toLowerCase());
    return {
      id: p.id,
      name: p.name,
      title: p.title,
      branch: p.branch_id ? branchName.get(p.branch_id) ?? null : null,
      email: p.email,
      queue_role: p.queue_role,
      account: !u ? "none" : u.queue_role || effectiveQueueRole(u) ? "linked" : "no_access",
    };
  });
  const adminUsers: AdminUser[] = (users ?? [])
    .filter((u) => u.role !== "technician")
    .map((u) => ({
      id: u.id,
      name: u.full_name || u.email,
      email: u.email,
      role: u.role,
      branch: u.branch_id ? branchName.get(u.branch_id) ?? null : null,
      queue_role: u.queue_role,
      fromRole: u.queue_role ? null : effectiveQueueRole(u),
      job_title: u.job_title,
    }));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Queue admin</h1>
      <QueueAdmin branches={adminBranches} users={adminUsers} people={adminPeople} />
    </div>
  );
}
