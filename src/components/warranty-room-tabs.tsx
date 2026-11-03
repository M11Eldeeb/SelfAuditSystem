import Link from "next/link";

const AMS_URL = "https://portal.smil.com";

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
      {/* AMS (Warranty Submission Website) is another company's site that refuses to be shown inside other pages (X-Frame-Options: SAMEORIGIN), so it opens in its own tab. */}
      <a
        href={AMS_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="Open AMS - Warranty Submission Website - in a new tab"
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100"
      >
        AMS (Warranty Submission)
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 3h4v4M13 3L7.5 8.5M12 9.5V12a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1h2.5" />
        </svg>
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </nav>
  );
}
