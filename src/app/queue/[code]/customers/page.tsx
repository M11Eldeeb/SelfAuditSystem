import { createAdminClient } from "@/lib/supabase/admin";
import { queuePage } from "@/lib/queue/pages";
import { BranchTabs } from "@/components/queue/branch-tabs";
import { STATUS_LABEL, serviceText, startOfSaudiDay, type QueueTicket } from "@/lib/queue/core";

/** The branch's queue customers (last 180 days): one line per mobile, with their visits. Search by name, mobile or WIP. */
export default async function QueueCustomersPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ q?: string }> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const { a, branch } = await queuePage(code, "manager");
  const q = String(sp.q ?? "").trim().slice(0, 60);
  const { data } = await createAdminClient()
    .from("self_audit_queue_tickets")
    .select("*")
    .eq("branch_id", branch.id)
    .gte("queue_entry_at", startOfSaudiDay(179))
    .order("queue_entry_at", { ascending: false })
    .limit(5000);
  const tickets = (data ?? []) as QueueTicket[];
  const byMobile = new Map<string, QueueTicket[]>();
  for (const tk of tickets) byMobile.set(tk.mobile, [...(byMobile.get(tk.mobile) ?? []), tk]);
  const needle = q.toLowerCase();
  const digits = q.replace(/\D/g, "");
  const customers = [...byMobile.entries()]
    .filter(([mobile, list]) => !q || list.some((tk) => tk.customer_name.toLowerCase().includes(needle) || (digits.length >= 3 && (mobile.includes(digits) || (tk.wip_number ?? "").includes(digits)))))
    .slice(0, 200);
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <BranchTabs code={branch.queue_code} name={branch.name} active="customers" manager role={a.role} />
      <form className="mb-4 flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search name, mobile or WIP" className="h-10 w-full max-w-sm rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-brand" />
        <button className="rounded-lg bg-neutral-900 px-4 text-sm font-semibold text-white">Search</button>
      </form>
      <p className="mb-3 text-xs text-neutral-500">
        {byMobile.size} customers in the last 180 days{q && ` · ${customers.length} match`}.
      </p>
      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-neutral-200/70">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-start font-medium">Customer</th>
              <th className="px-3 py-2 text-start font-medium">Mobile</th>
              <th className="px-3 py-2 text-end font-medium">Visits</th>
              <th className="px-3 py-2 text-start font-medium">Last visit</th>
              <th className="px-3 py-2 text-start font-medium">Service</th>
              <th className="px-3 py-2 text-start font-medium">Advisor</th>
              <th className="px-3 py-2 text-start font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {customers.map(([mobile, list]) => {
              const last = list[0];
              return (
                <tr key={mobile}>
                  <td className="px-3 py-2 font-medium text-neutral-900">{last.customer_name}</td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    <a href={`tel:${mobile}`} className="hover:underline">
                      {mobile}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{list.length}</td>
                  <td className="px-3 py-2 text-neutral-600">
                    {when(last.queue_entry_at)} · {last.ticket_number}
                    {last.wip_number && <span dir="ltr"> · WIP {last.wip_number}</span>}
                  </td>
                  <td className="px-3 py-2 text-neutral-600">{serviceText(last, "en")}</td>
                  <td className="px-3 py-2 text-neutral-600">{last.advisor_name ?? "—"}</td>
                  <td className="px-3 py-2 text-neutral-600">{STATUS_LABEL[last.status][0]}</td>
                </tr>
              );
            })}
            {customers.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-neutral-400">
                  No customers.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
