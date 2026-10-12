"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Folder = "overview" | "self" | "internal";

const starts = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

function folderFor(pathname: string): Folder | null {
  if (pathname === "/admin/audits") return "overview";
  if (starts(pathname, "/admin/cycles") || starts(pathname, "/admin/review") || starts(pathname, "/admin/results/self-audit")) return "self";
  if (starts(pathname, "/admin/internal-audit") || starts(pathname, "/admin/results/internal-audit")) return "internal";
  return null;
}

const FOLDERS: { id: Folder; label: string; href: string }[] = [
  { id: "overview", label: "Overview", href: "/admin/audits" },
  { id: "self", label: "Self Audit", href: "/admin/cycles" },
  { id: "internal", label: "Internal Audit", href: "/admin/internal-audit" },
];

/**
 * Secondary navigation for everything under the Audits tab: the Overview and
 * the two folders, and inside a folder its work page and its Results.
 */
export function AuditsNav() {
  const pathname = usePathname();
  const folder = folderFor(pathname);

  const sub =
    folder === "self"
      ? {
          work: { label: "Cycles & reviews", href: "/admin/cycles", active: !starts(pathname, "/admin/results/self-audit") },
          results: { label: "Results", href: "/admin/results/self-audit", active: starts(pathname, "/admin/results/self-audit") },
        }
      : folder === "internal"
        ? {
            work: { label: "Audits", href: "/admin/internal-audit", active: !starts(pathname, "/admin/results/internal-audit") },
            results: { label: "Results", href: "/admin/results/internal-audit", active: starts(pathname, "/admin/results/internal-audit") },
          }
        : null;

  return (
    <div className="mb-6 space-y-3 print:hidden">
      <nav aria-label="Audits" className="flex gap-1 border-b border-neutral-200">
        {FOLDERS.map((f) => {
          const active = folder === f.id;
          return (
            <Link
              key={f.id}
              href={f.href}
              aria-current={active ? "page" : undefined}
              className={`relative -mb-px px-4 py-2.5 text-sm font-medium transition-colors ${
                active ? "text-neutral-900" : "text-neutral-500 hover:text-neutral-800"
              }`}
            >
              {f.label}
              <span
                className={`absolute inset-x-3 bottom-0 h-0.5 origin-center rounded-full bg-brand transition-transform duration-300 ease-out motion-reduce:transition-none ${
                  active ? "scale-x-100" : "scale-x-0"
                }`}
              />
            </Link>
          );
        })}
      </nav>

      {sub && (
        <div role="tablist" aria-label={`${folder === "self" ? "Self Audit" : "Internal Audit"} sections`} className="inline-flex gap-1 rounded-lg bg-neutral-100 p-1">
          {[sub.work, sub.results].map((t) => (
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
      )}
    </div>
  );
}
