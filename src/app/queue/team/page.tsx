import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { effectiveQueueRole, getQueueAccess } from "@/lib/queue/server";

const LABEL = { advisor: "Service advisor", parts_advisor: "Spare parts advisor", manager: "Queue manager" } as const;

/** Who works in the customer queue (the portal's own accounts), by branch. Branch people see their branch. */
export default async function QueueTeamPage() {
  const a = await getQueueAccess();
  if (!a) redirect("/");
  const admin = createAdminClient();
  const [{ data: users }, { data: branches }] = await Promise.all([
    admin.from("self_audit_users").select("id, full_name, email, role, branch_id, queue_role, job_title").order("full_name"),
    admin.from("self_audit_branches").select("id, name").eq("active", true).order("name"),
  ]);
  const people = (users ?? [])
    .map((u) => ({ ...u, q: effectiveQueueRole(u) }))
    .filter((u) => u.q && (a.allBranches || u.branch_id === a.branchId));
  const groups = [...(branches ?? []).map((b) => ({ id: b.id as string | null, name: b.name })), { id: null, name: "Head office" }]
    .map((g) => ({ ...g, people: people.filter((p) => p.branch_id === g.id) }))
    .filter((g) => g.people.length);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Team</h1>
      {groups.length === 0 && <p className="text-sm text-neutral-500">No one has queue access yet.</p>}
      {groups.map((g) => (
        <section key={g.id ?? "hq"} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
          <h2 className="mb-2 font-semibold text-neutral-900">{g.name}</h2>
          <ul className="divide-y divide-neutral-100 text-sm">
            {g.people.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium text-neutral-900">{p.full_name || p.email}</span>
                  {p.job_title && <span className="text-neutral-500"> · {p.job_title}</span>}
                </span>
                <span className="flex items-center gap-3 text-xs text-neutral-500">
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-700">{LABEL[p.q!]}</span>
                  <a href={`mailto:${p.email}`} className="hover:underline" dir="ltr">
                    {p.email}
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
