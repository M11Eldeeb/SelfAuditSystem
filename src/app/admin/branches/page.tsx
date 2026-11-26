import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BranchForm } from "./branch-form";
import { UserForm } from "./user-form";
import { TechnicianImport } from "./technician-import";
import { ExportUsersButton } from "./export-users";
import { ResetPasswordButton } from "./reset-password-button";
import { WelcomeEmailButton } from "./welcome-email-button";
import { getsCourtesyWelcome, signedInIds, welcomeSentMap } from "@/lib/courtesy/welcome-mail";
import { QC_WELCOME_KIND } from "@/lib/qc/welcome-mail";
import { WelcomeAllButton } from "./welcome-all-button";
import { EditUserButton } from "./edit-user-button";
import { BranchRow } from "./branch-row";
import { DeleteUserButton } from "./delete-user-button";
import { compareUsers } from "@/lib/user-roles";
import { UserFolders, type UserFolder } from "./user-folders";

// Sending the welcome e-mail to many new accounts at once takes a while.
export const maxDuration = 60;

const ROLE_LABEL: Record<string, string> = {
  officer: "Warranty officer",
  technical: "Technical team",
  workshop_supervisor: "Workshop supervisor",
  team_leader: "Team leader",
  national_manager: "National Manager (view only)",
  manager: "Manager (view only)",
  data_analyst: "Data Analyst (Sub-Dealer only)",
  service_manager: "Service manager (view only)",
  technician: "Technician",
  claims_reviewer: "Technician claims reviewer",
  service_advisor: "Service advisor",
  quality_controller: "Quality controller",
  quality_supervisor: "Quality supervisor",
  queue_user: "Queue only",
  branch_admin: "Branch admin",
};
const roleLabel = (role: string) => ROLE_LABEL[role] ?? "Branch admin";

const sentOn = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Riyadh" });

export default async function BranchesPage() {
  const [currentUser, supabase] = await Promise.all([getCurrentUser(), createClient()]);

  const [{ data: branches }, { data: users }, courtesySent, signedIn, qcSent] = await Promise.all([
    supabase.from("self_audit_branches").select("*").order("name"),
    supabase.from("self_audit_users").select("*").order("email"),
    welcomeSentMap(),
    signedInIds(),
    welcomeSentMap(QC_WELCOME_KIND),
  ]);
  const welcomeSent = courtesySent;
  // New service advisor / reception accounts still waiting for the welcome e-mail (never signed in).
  const welcomeWaiting = (users ?? []).filter((u) => getsCourtesyWelcome(u.role, u.queue_role) && !welcomeSent.has(u.email.toLowerCase()) && !signedIn.has(u.id)).length;

  const branchList = branches ?? [];
  const branchNameById = new Map(branchList.map((b) => [b.id, b.name]));
  // Highest role first (officer ... technician), then branch, then name.
  const sortedUsers = [...(users ?? [])].sort((a, b) =>
    compareUsers({ ...a, branchName: a.branch_id ? branchNameById.get(a.branch_id) : null }, { ...b, branchName: b.branch_id ? branchNameById.get(b.branch_id) : null })
  );

  // One folder per role, in the order of the list above (highest role first); each row is drawn here and searched in the browser.
  const folders: UserFolder[] = [];
  for (const u of sortedUsers) {
    let f = folders.find((x) => x.role === u.role);
    if (!f) folders.push((f = { role: u.role, label: roleLabel(u.role), users: [] }));
    const branchName = u.branch_id ? (branchNameById.get(u.branch_id) ?? "") : "";
    f.users.push({
      id: u.id,
      text: [u.email, u.full_name, u.employee_no, branchName, roleLabel(u.role)].filter(Boolean).join(" ").toLowerCase(),
      row: (
        <>
          <td className="px-4 py-2 text-neutral-900">{u.email}</td>
          <td className="px-4 py-2 text-neutral-600">
            {u.full_name ?? "—"}
            {u.employee_no && <span className="ml-1 text-xs text-neutral-400">#{u.employee_no}</span>}
          </td>
          <td className="px-4 py-2 text-neutral-600">
            {roleLabel(u.role)}
          </td>
          <td className="px-4 py-2 text-neutral-600">
            {u.branch_id ? (branchNameById.get(u.branch_id) ?? "—") : "—"}
          </td>
          <td className="px-4 py-2 text-right">
            <div className="flex items-start justify-end gap-3">
              <EditUserButton
                user={{ id: u.id, email: u.email, full_name: u.full_name, role: u.role, queue_role: u.queue_role, branch_id: u.branch_id, view_all: u.view_all, courtesy_access: u.courtesy_access, tech_submit: u.tech_submit }}
                branches={branchList.filter((b) => b.active || b.id === u.branch_id).map((b) => ({ id: b.id, name: b.name }))}
                self={u.id === currentUser?.id}
              />
              {u.id === currentUser?.id ? (
                <Link
                  href="/account/password"
                  className="text-xs text-neutral-600 hover:text-neutral-900"
                >
                  Change password
                </Link>
              ) : (
                <>
                  {(getsCourtesyWelcome(u.role, u.queue_role) || u.role === "quality_controller") &&
                    ((u.role === "quality_controller" ? qcSent : welcomeSent).has(u.email.toLowerCase()) ? (
                      <span className="text-xs text-emerald-700" title="The welcome e-mail is sent once per account">
                        ✓ Welcome e-mail sent {sentOn((u.role === "quality_controller" ? qcSent : welcomeSent).get(u.email.toLowerCase())!)}
                      </span>
                    ) : (
                      <WelcomeEmailButton userId={u.id} email={u.email} />
                    ))}
                  <ResetPasswordButton userId={u.id} email={u.email} />
                  <DeleteUserButton userId={u.id} email={u.email} />
                </>
              )}
            </div>
          </td>
        </>
      ),
    });
  }

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Branches</h1>
        <div className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
          <BranchForm />
        </div>
        <div className="overflow-hidden rounded-xl border border-neutral-200/70 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-semibold tracking-wide text-neutral-500 uppercase border-b border-neutral-200">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {branchList.map((b) => (
                <BranchRow key={b.id} branch={b} />
              ))}
              {branchList.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-neutral-400">
                    No branches yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Users</h1>
          <ExportUsersButton />
        </div>
        <div className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
          <UserForm branches={branchList.filter((b) => b.active)} />
        </div>
        <WelcomeAllButton count={welcomeWaiting} />
        <div className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
          <TechnicianImport />
        </div>
        {(users ?? []).length === 0 ? (
          <p className="rounded-xl border border-neutral-200/70 bg-white p-6 text-center text-sm text-neutral-400 shadow-sm">No users yet.</p>
        ) : (
          <UserFolders folders={folders} />
        )}
      </section>
    </div>
  );
}
