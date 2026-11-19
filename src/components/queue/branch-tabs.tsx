import Link from "next/link";

/** The tabs of one branch's queue pages (for head office, who reach a branch from the overview). */
export function BranchTabs({ code, name, active, manager, role }: { code: string; name: string; active: string; manager: boolean; role: string }) {
  const tabs = [
    role !== "parts_advisor" && { href: `/queue/${code}`, key: "service", label: "Service desk" },
    role !== "advisor" && { href: `/queue/${code}/parts`, key: "parts", label: "Spare parts" },
    { href: `/queue/${code}/analytics`, key: "analytics", label: "Analytics" },
    manager && { href: `/queue/${code}/customers`, key: "customers", label: "Customers" },
    manager && { href: `/queue/${code}/settings`, key: "settings", label: "Working hours & settings" },
  ].filter(Boolean) as { href: string; key: string; label: string }[];
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{name}</h1>
      <nav className="flex flex-wrap gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-neutral-200/70">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${t.key === active ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
          >
            {t.label}
          </Link>
        ))}
        {manager && (
          <a href={`/q/display/${code}`} target="_blank" rel="noreferrer" className="rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100">
            TV ↗
          </a>
        )}
        {manager && (
          <a href={`/api/queue/poster/${code}`} target="_blank" rel="noreferrer" className="rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100">
            Reception poster ↗
          </a>
        )}
      </nav>
    </div>
  );
}
