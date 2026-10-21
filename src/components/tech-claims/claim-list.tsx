import Link from "next/link";
import type { TechClaimStatus, TechClaimSummary } from "@/lib/tech-claims/server";
import { StatusPill, fmtDateTime } from "./status";

export type ListTab = { key: string; label: string; count?: number };

/** Tabs (by status) + search + the claims as cards (phone) / rows. `base` is the page, e.g. /audit/technician-claims. */
export function TechClaimList({
  base,
  claims,
  tabs,
  active,
  q,
  showBranch,
  showTechnician,
  extraParams = {},
}: {
  base: string;
  claims: TechClaimSummary[];
  tabs: ListTab[];
  active: string;
  q?: string;
  showBranch?: boolean;
  showTechnician?: boolean;
  extraParams?: Record<string, string>;
}) {
  const href = (status: string) => {
    const p = new URLSearchParams({ ...extraParams, status });
    if (q) p.set("q", q);
    return `${base}?${p.toString()}`;
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={href(t.key)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${active === t.key ? "bg-brand text-white" : "bg-white text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50"}`}
          >
            {t.label}
            {t.count != null && <span className="ml-1.5 opacity-80">{t.count}</span>}
          </Link>
        ))}
      </div>
      <form action={base} className="flex gap-2">
        {Object.entries({ ...extraParams, status: active }).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <input name="q" defaultValue={q} placeholder="Search VIN, work order, claim no. or technician" className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none" />
        <button className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50">Search</button>
      </form>

      {claims.length === 0 ? (
        <p className="rounded-xl bg-white p-6 text-center text-sm text-neutral-500 shadow-sm ring-1 ring-neutral-200/70">No claims here.</p>
      ) : (
        <ul className="space-y-2">
          {claims.map((c) => (
            <li key={c.id}>
              <Link href={`${base}/${c.id}`} className="block rounded-xl bg-white p-3 shadow-sm ring-1 ring-neutral-200/70 hover:ring-brand/40">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-neutral-900">{c.claimNo}</span>
                    <span className="text-sm text-neutral-600">WO {c.workOrder}</span>
                  </div>
                  <StatusPill status={c.status as TechClaimStatus} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
                  <span className="font-mono">{c.vin}</span>
                  {showTechnician && <span>{c.technician}</span>}
                  {showBranch && <span>{c.branch}</span>}
                  <span>{c.files} file{c.files === 1 ? "" : "s"}</span>
                  <span>{c.submittedAt ? `sent ${fmtDateTime(c.submittedAt)}` : `started ${fmtDateTime(c.createdAt)}`}</span>
                  {c.timesSubmitted > 1 && <span>sent {c.timesSubmitted} times</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {claims.length >= 300 && <p className="text-xs text-neutral-500">Showing the first 300 - search to narrow it down.</p>}
    </div>
  );
}
