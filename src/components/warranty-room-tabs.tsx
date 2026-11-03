import Link from "next/link";

/** Warranty Room and Part Return sit under one menu entry; this switches between the two. `area` is "admin" (officers) or "audit" (branch admins). */
export function WarrantyRoomTabs({ area, active }: { area: "admin" | "audit"; active: "room" | "returns" }) {
  const tabs = [
    { key: "room" as const, label: "Warranty Room", href: `/${area}/warranty-room` },
    { key: "returns" as const, label: "Part Return", href: `/${area}/warranty-room/part-returns` },
  ];
  return (
    <nav aria-label="Warranty Room sections" className="flex w-fit flex-wrap gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-neutral-200/70">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${t.key === active ? "bg-brand text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
