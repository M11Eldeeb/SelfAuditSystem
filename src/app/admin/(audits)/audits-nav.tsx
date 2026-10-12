"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const starts = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * Navigation inside an audit folder: a way back to the Audits home and a
 * switch between the folder's work page and its Results. The Audits home
 * itself shows nothing here - its two folder cards are the way in.
 */
export function AuditsNav() {
  const pathname = usePathname();

  const folder = (() => {
    if (starts(pathname, "/admin/cycles") || starts(pathname, "/admin/review") || starts(pathname, "/admin/results/self-audit")) {
      return {
        name: "Self Audit",
        work: { label: "Cycles & reviews", href: "/admin/cycles", active: !starts(pathname, "/admin/results/self-audit") },
        results: { label: "Results", href: "/admin/results/self-audit", active: starts(pathname, "/admin/results/self-audit") },
      };
    }
    if (starts(pathname, "/admin/internal-audit") || starts(pathname, "/admin/results/internal-audit")) {
      return {
        name: "Internal Audit",
        work: { label: "Audits", href: "/admin/internal-audit", active: !starts(pathname, "/admin/results/internal-audit") },
        results: { label: "Results", href: "/admin/results/internal-audit", active: starts(pathname, "/admin/results/internal-audit") },
      };
    }
    return null;
  })();

  if (!folder) return null;

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 print:hidden">
      <Link href="/admin/audits" className="text-sm text-neutral-500 transition-colors hover:text-neutral-800">
        &larr; Audits
      </Link>
      <span className="h-4 w-px bg-neutral-200" aria-hidden="true" />
      <span className="text-sm font-semibold text-neutral-900">{folder.name}</span>
      <div role="tablist" aria-label={`${folder.name} sections`} className="inline-flex gap-1 rounded-lg bg-neutral-100 p-1">
        {[folder.work, folder.results].map((t) => (
          <Link
            key={t.href}
            href={t.href}
            role="tab"
            aria-selected={t.active}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              t.active ? "bg-white text-neutral-900 shadow-sm ring-1 ring-black/5" : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
