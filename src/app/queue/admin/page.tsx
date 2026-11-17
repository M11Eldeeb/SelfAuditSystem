import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { createAdminClient } from "@/lib/supabase/admin";
import { getQueueAccess } from "@/lib/queue/server";
import { siteOrigin } from "@/lib/site-origin";
import { QueueAdmin, type AdminBranch, type AdminPerson, type AdminUser } from "@/components/queue/queue-admin";

/** Queue admin (warranty officers): branch codes and QR, the old app's queue people, and queue access per account. */
export default async function QueueAdminPage() {
  const a = await getQueueAccess();
  if (!a?.admin) redirect("/queue");
  const admin = createAdminClient();
  const [{ data: branches }, { data: users }, { data: people }, origin] = await Promise.all([
    admin.from("self_audit_branches").select("id, name, queue_code, name_ar, queue_status").eq("active", true).order("name"),
    admin.from("self_audit_users").select("id, full_name, email, role, branch_id, queue_role, job_title").order("full_name"),
    admin.from("self_audit_queue_employees").select("id, name, title, branch_name, email, queue_role").not("queue_role", "is", null).order("name"),
    siteOrigin(),
  ]);
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const adminBranches: AdminBranch[] = await Promise.all(
    (branches ?? []).map(async (b) => {
      const joinUrl = b.queue_code ? `${origin}/q/${b.queue_code}` : null;
      return { ...b, joinUrl, qrSvg: joinUrl ? await QRCode.toString(joinUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) : null };
    })
  );
  const byEmail = new Map((users ?? []).map((u) => [u.email.trim().toLowerCase(), u]));
  const adminPeople: AdminPerson[] = (people ?? []).map((p) => {
    const u = byEmail.get((p.email ?? "").replace(/[\s​]/g, "").toLowerCase());
    return {
      id: p.id,
      name: p.name,
      title: p.title,
      branch: p.branch_name === "Head Office" ? null : p.branch_name,
      email: p.email,
      queue_role: p.queue_role!,
      account: !u ? "none" : u.queue_role ? "linked" : "no_access",
    };
  });
  const adminUsers: AdminUser[] = (users ?? [])
    .filter((u) => u.role !== "technician")
    .map((u) => ({ id: u.id, name: u.full_name || u.email, email: u.email, role: u.role, branch: u.branch_id ? branchName.get(u.branch_id) ?? null : null, queue_role: u.queue_role, job_title: u.job_title }));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Queue admin</h1>
      <QueueAdmin branches={adminBranches} users={adminUsers} people={adminPeople} />
    </div>
  );
}
