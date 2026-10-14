"use client";

import { useState, useTransition } from "react";
import { addServiceManager, removeServiceManager } from "./actions";

export type BranchManagers = { branchId: string; branchName: string; managers: { id: string; email: string }[] };

/** Each branch's service managers: copied on the self-audit mails. Add or remove an address per branch. */
export function ServiceManagers({ branches }: { branches: BranchManagers[] }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add(branchId: string) {
    const email = drafts[branchId] ?? "";
    if (!email.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await addServiceManager(branchId, email);
      if (res.error) setError(res.error);
      else setDrafts((d) => ({ ...d, [branchId]: "" }));
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await removeServiceManager(id);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200/70 bg-white shadow-sm">
        {branches.map((b) => (
          <li key={b.branchId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <span className="w-40 shrink-0 text-sm font-medium text-neutral-900">{b.branchName}</span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {b.managers.length === 0 && <span className="text-xs text-amber-700">No service manager yet</span>}
              {b.managers.map((m) => (
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
                value={drafts[b.branchId] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [b.branchId]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add(b.branchId);
                  }
                }}
                placeholder="name@jiadmotors.com"
                aria-label={`Add a service manager for ${b.branchName}`}
                disabled={pending}
                className="w-52 rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => add(b.branchId)}
                disabled={pending || !(drafts[b.branchId] ?? "").trim()}
                className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
