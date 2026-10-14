"use client";

import { useState, useTransition } from "react";
import { saveInquiryRouting } from "@/app/actions/technical-inquiries";

/**
 * Officers: which technician looks after which branch. A new case from a branch is assigned to its technician at once
 * (and the "new case" mail goes to them). Changes save as soon as they are made.
 */
export function RoutingEditor({
  branches,
  technicians,
  routing,
}: {
  branches: { id: string; name: string }[];
  technicians: { id: string; name: string }[];
  /** branch id -> technician id */
  routing: Record<string, string>;
}) {
  const [current, setCurrent] = useState<Record<string, string>>(routing);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function change(branchId: string, technicianId: string) {
    setError(null);
    setSaved(null);
    const before = current[branchId] ?? "";
    setCurrent((c) => ({ ...c, [branchId]: technicianId }));
    startTransition(async () => {
      const res = await saveInquiryRouting({ branchId, technicianId: technicianId || null });
      if (res.error) {
        setError(res.error);
        setCurrent((c) => ({ ...c, [branchId]: before }));
      } else {
        setSaved(branches.find((b) => b.id === branchId)?.name ?? null);
      }
    });
  }

  return (
    <details className="group rounded-xl border border-neutral-200/70 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-50">
        <span>Who handles which branch</span>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="text-neutral-400 transition-transform duration-200 group-open:rotate-180">
          <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="space-y-3 border-t border-neutral-100 p-4">
        {technicians.length === 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            There is no technical team account yet. Create the technicians under Branches &amp; Users (account type &quot;Technical team&quot;), then choose who handles each branch here.
          </p>
        ) : (
          <>
            <p className="text-xs text-neutral-500">A new case from a branch goes to the technician chosen here. A branch with nobody chosen goes to the whole technical team.</p>
            <ul className="divide-y divide-neutral-100">
              {branches.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-sm text-neutral-900">{b.name}</span>
                  <select
                    value={current[b.id] ?? ""}
                    onChange={(e) => change(b.id, e.target.value)}
                    disabled={pending}
                    aria-label={`Technician for ${b.name}`}
                    className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900 shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
                  >
                    <option value="">Whole technical team</option>
                    {technicians.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {saved && !error && <p className="text-xs text-emerald-700">Saved for {saved}.</p>}
      </div>
    </details>
  );
}
