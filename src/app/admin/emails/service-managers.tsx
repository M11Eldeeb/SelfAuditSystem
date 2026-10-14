"use client";

import { useState, useTransition } from "react";
import { addBranchContact, removeBranchContact } from "./actions";

export type BranchContactRole = "service_manager" | "workshop_supervisor" | "workshop_team_leader";
export type BranchManagers = { branchId: string; branchName: string; contacts: { id: string; email: string; role: BranchContactRole }[] };

const ROLES: { role: BranchContactRole; label: string; empty: string }[] = [
  { role: "service_manager", label: "Service manager(s)", empty: "None yet" },
  { role: "workshop_supervisor", label: "Workshop supervisor(s)", empty: "None yet" },
  { role: "workshop_team_leader", label: "Workshop team leader(s)", empty: "None yet" },
];

/**
 * Each branch's contacts that are copied on the mails: service managers (self-audit and inquiry mails), workshop
 * supervisors and workshop team leaders (the technical inquiry mails to the workshop). Add or remove an address per role.
 */
export function ServiceManagers({ branches }: { branches: BranchManagers[] }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add(branchId: string, role: BranchContactRole) {
    const draftKey = `${branchId}:${role}`;
    const email = drafts[draftKey] ?? "";
    if (!email.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await addBranchContact(branchId, role, email);
      if (res.error) setError(res.error);
      else setDrafts((d) => ({ ...d, [draftKey]: "" }));
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await removeBranchContact(id);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200/70 bg-white shadow-sm">
        {branches.map((b) => (
          <li key={b.branchId} className="space-y-2 px-4 py-3">
            <p className="text-sm font-semibold text-neutral-900">{b.branchName}</p>
            {ROLES.map(({ role, label, empty }) => {
              const list = b.contacts.filter((c) => c.role === role);
              const draftKey = `${b.branchId}:${role}`;
              return (
                <div key={role} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="w-44 shrink-0 text-xs font-medium text-neutral-600">{label}</span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    {list.length === 0 && <span className={`text-xs ${role === "service_manager" ? "text-amber-700" : "text-neutral-500"}`}>{empty}</span>}
                    {list.map((m) => (
                      <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 py-0.5 pr-1 pl-2.5 text-xs text-neutral-800 ring-1 ring-neutral-200 ring-inset">
                        {m.email}
                        <button
                          type="button"
                          onClick={() => remove(m.id)}
                          disabled={pending}
                          aria-label={`Remove ${m.email}`}
                          className="flex h-4 w-4 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-200 hover:text-red-600 disabled:opacity-50"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <input
                      type="email"
                      value={drafts[draftKey] ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [draftKey]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          add(b.branchId, role);
                        }
                      }}
                      placeholder="name@jiadmotors.com"
                      aria-label={`Add to ${label} of ${b.branchName}`}
                      disabled={pending}
                      className="w-52 rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={() => add(b.branchId, role)}
                      disabled={pending || !(drafts[draftKey] ?? "").trim()}
                      className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </div>
              );
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}
