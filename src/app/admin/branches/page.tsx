import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BranchForm } from "./branch-form";
import { UserForm } from "./user-form";
import { ResetPasswordButton } from "./reset-password-button";
import { BranchRow } from "./branch-row";
import { DeleteUserButton } from "./delete-user-button";

export default async function BranchesPage() {
  const [currentUser, supabase] = await Promise.all([getCurrentUser(), createClient()]);

  const [{ data: branches }, { data: users }] = await Promise.all([
    supabase.from("branches").select("*").order("name"),
    supabase.from("users").select("*").order("email"),
  ]);

  const branchList = branches ?? [];
  const branchNameById = new Map(branchList.map((b) => [b.id, b.name]));

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Branches</h1>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <BranchForm />
        </div>
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {branchList.map((b) => (
                <BranchRow key={b.id} branch={b} />
              ))}
              {branchList.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-neutral-400">
                    No branches yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Users</h1>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <UserForm branches={branchList} />
        </div>
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Branch</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {(users ?? []).map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-2 text-neutral-900">{u.email}</td>
                  <td className="px-4 py-2 text-neutral-600">{u.full_name ?? "—"}</td>
                  <td className="px-4 py-2 text-neutral-600">
                    {u.role === "officer" ? "Warranty officer" : "Branch admin"}
                  </td>
                  <td className="px-4 py-2 text-neutral-600">
                    {u.branch_id ? (branchNameById.get(u.branch_id) ?? "—") : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-start justify-end gap-3">
                      <ResetPasswordButton userId={u.id} email={u.email} />
                      {u.id !== currentUser?.id && <DeleteUserButton userId={u.id} email={u.email} />}
                    </div>
                  </td>
                </tr>
              ))}
              {(users ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-neutral-400">
                    No users yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
