"use client";

import { useState, type ReactNode } from "react";

export type UserFolder = {
  role: string;
  label: string;
  /** One table row per account; `text` is what the search looks in (e-mail, name, employee no., branch, role). */
  users: { id: string; text: string; row: ReactNode }[];
};

/**
 * Branches & Users: the accounts in one folder per role (opened with a tap), with a search over every account. While
 * searching, only the folders with a match show, already open, with only the matching accounts.
 */
export function UserFolders({ folders }: { folders: UserFolder[] }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searching = words.length > 0;
  const shown = folders
    .map((f) => ({ ...f, users: searching ? f.users.filter((u) => words.every((w) => u.text.includes(w))) : f.users }))
    .filter((f) => !searching || f.users.length > 0);
  const total = shown.reduce((n, f) => n + f.users.length, 0);
  const toggle = (role: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <svg className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-neutral-400" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="9" cy="9" r="5.75" stroke="currentColor" strokeWidth="1.6" />
            <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search users - name, e-mail, employee no., branch or role"
            aria-label="Search users"
            className="w-full rounded-xl border border-neutral-300 bg-white py-2.5 pr-3 pl-9 text-sm shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
          />
        </div>
        {searching ? (
          <span className="text-sm text-neutral-500">
            {total} match{total === 1 ? "" : "es"}
          </span>
        ) : (
          <div className="flex gap-2 text-sm">
            <button type="button" onClick={() => setOpen(new Set(folders.map((f) => f.role)))} className="font-medium text-brand hover:text-brand-dark">
              Open all
            </button>
            <span className="text-neutral-300">|</span>
            <button type="button" onClick={() => setOpen(new Set())} className="font-medium text-neutral-600 hover:text-neutral-900">
              Close all
            </button>
          </div>
        )}
      </div>

      {shown.length === 0 && <p className="rounded-xl border border-neutral-200/70 bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">No user matches &ldquo;{query.trim()}&rdquo;.</p>}

      {shown.map((f) => {
        const isOpen = searching || open.has(f.role);
        return (
          <div key={f.role} className="overflow-hidden rounded-xl border border-neutral-200/70 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => !searching && toggle(f.role)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-neutral-50"
            >
              <span className="flex items-center gap-2.5">
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true" className={isOpen ? "text-brand" : "text-neutral-400"}>
                  <path d="M2.75 5.5A1.75 1.75 0 014.5 3.75h3.3l1.6 1.75h6.1a1.75 1.75 0 011.75 1.75v7.25a1.75 1.75 0 01-1.75 1.75h-11A1.75 1.75 0 012.75 14.5v-9z" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                <span className="font-semibold text-neutral-900">{f.label}</span>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600">{f.users.length}</span>
              </span>
              {!searching && <span className={`text-neutral-400 transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>}
            </button>
            {isOpen && (
              <div className="overflow-x-auto border-t border-neutral-100">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 text-left text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                    <tr>
                      <th className="px-4 py-2">Email</th>
                      <th className="px-4 py-2">Name</th>
                      <th className="px-4 py-2">Role</th>
                      <th className="px-4 py-2">Branch</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {f.users.map((u) => (
                      <tr key={u.id}>{u.row}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
