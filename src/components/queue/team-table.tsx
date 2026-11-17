"use client";

import { useMemo, useState, useTransition } from "react";
import { updateEmployee } from "@/app/actions/queue-admin";

export type TeamMember = { id: string; name: string; title: string | null; city: string | null; branch_id: string | null; branch_name: string | null; phone: string | null; email: string | null };

type Draft = { name: string; title: string; city: string; branchId: string; phone: string; email: string };

/** The after-sales team list: search, branch filter; the warranty officers can correct a line. */
export function TeamTable({ people, branches, canEdit }: { people: TeamMember[]; branches: { id: string; name: string }[]; canEdit: boolean }) {
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", title: "", city: "", branchId: "", phone: "", email: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const branchLabels = useMemo(() => Array.from(new Set(people.map((p) => p.branch_name).filter(Boolean))).sort() as string[], [people]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return people.filter((p) => (!branch || p.branch_name === branch) && (!n || [p.name, p.title, p.branch_name, p.email, p.phone].some((v) => (v ?? "").toLowerCase().includes(n))));
  }, [people, q, branch]);

  const input = "h-8 w-full rounded border border-neutral-200 px-2 text-sm";
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, title, phone, e-mail" className="h-10 w-full max-w-sm rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-brand" />
        <select value={branch} onChange={(e) => setBranch(e.target.value)} className="h-10 rounded-lg border border-neutral-200 bg-white px-3 text-sm">
          <option value="">All branches</option>
          {branchLabels.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <span className="self-center text-xs text-neutral-500">{shown.length} people</span>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-neutral-200/70">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            <tr>
              {["Name", "Title", "Branch", "City", "Phone", "E-mail", ""].map((h) => (
                <th key={h} className="px-3 py-2 text-start font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {shown.map((p) =>
              editing === p.id ? (
                <tr key={p.id} className="bg-brand/5">
                  <td className="px-2 py-1.5">
                    <input className={input} value={draft.name} onChange={set("name")} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input className={input} value={draft.title} onChange={set("title")} />
                  </td>
                  <td className="px-2 py-1.5">
                    <select className={input} value={draft.branchId} onChange={set("branchId")}>
                      <option value="">{p.branch_name ?? "—"}</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input className={input} value={draft.city} onChange={set("city")} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input className={input} dir="ltr" value={draft.phone} onChange={set("phone")} />
                  </td>
                  <td className="px-2 py-1.5">
                    <input className={input} dir="ltr" value={draft.email} onChange={set("email")} />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const r = await updateEmployee(p.id, draft);
                          if (r.error) setError(r.error);
                          else {
                            setError(null);
                            setEditing(null);
                          }
                        })
                      }
                      className="rounded bg-brand px-2.5 py-1 text-xs font-semibold text-white"
                    >
                      Save
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="ms-1 px-2 py-1 text-xs text-neutral-500">
                      Cancel
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={p.id}>
                  <td className="px-3 py-2 font-medium text-neutral-900">{p.name}</td>
                  <td className="px-3 py-2 text-neutral-600">{p.title ?? "—"}</td>
                  <td className="px-3 py-2 text-neutral-600">{p.branch_name ?? "—"}</td>
                  <td className="px-3 py-2 text-neutral-600">{p.city ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {p.phone ? (
                      <a href={`tel:${p.phone}`} className="hover:underline">
                        {p.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-neutral-600" dir="ltr">
                    {p.email ? (
                      <a href={`mailto:${p.email}`} className="hover:underline">
                        {p.email}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(p.id);
                          setDraft({ name: p.name, title: p.title ?? "", city: p.city ?? "", branchId: p.branch_id ?? "", phone: p.phone ?? "", email: p.email ?? "" });
                        }}
                        className="text-xs font-semibold text-brand hover:underline"
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
