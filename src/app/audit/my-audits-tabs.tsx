"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const starts = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

const TABS = [
  { label: "Audits", href: "/audit", active: (p: string) => p === "/audit" },
  { label: "Results", href: "/audit/results", active: (p: string) => starts(p, "/audit/results") },
  { label: "Schedule", href: "/audit/audit-schedule", active: (p: string) => starts(p, "/audit/audit-schedule") },
];

/** My Audits holds the branch's audits, their results and the internal audit schedule as three tabs. */
export function MyAuditsTabs() {
  const pathname = usePathname();
  if (!TABS.some((t) => t.active(pathname))) return null;
  return (
    <div role="tablist" aria-label="My Audits" className="mb-6 inline-flex gap-1 rounded-lg bg-neutral-100 p-1 print:hidden">
      {TABS.map((t) => {
        const active = t.active(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            role="tab"
            aria-selected={active}
            className={`rounded-md px-4 py-1.5 text-[13px] font-medium transition ${active ? "bg-white text-neutral-900 shadow-sm ring-1 ring-black/5" : "text-neutral-600 hover:text-neutral-900"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
