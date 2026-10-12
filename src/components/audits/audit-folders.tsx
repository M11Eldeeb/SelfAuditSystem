import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { daysUntil } from "@/lib/cycle";

const monthLabel = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * The two audit folders on the Audits home: Self Audit and Internal Audit,
 * each with a live status line, a way into the work and a way into its
 * results (the old stand-alone Results tab now lives inside the folders).
 */
export async function AuditFolders() {
  const supabase = await createClient();

  const [{ data: openCycles }, { count: selfResults }, { count: selfHistorical }, { count: inProgress }, { count: finalized }, { count: intHistorical }] =
    await Promise.all([
      supabase.from("self_audit_audit_cycles").select("id, cycle_month, deadline_at").eq("status", "open").order("cycle_month", { ascending: false }).limit(1),
      supabase.from("self_audit_audit_results").select("id", { count: "exact", head: true }),
      supabase.from("self_audit_historical_audits").select("id", { count: "exact", head: true }).eq("audit_type", "self_audit"),
      supabase.from("self_audit_internal_audits").select("id", { count: "exact", head: true }).eq("status", "in_progress"),
      supabase.from("self_audit_internal_audits").select("id", { count: "exact", head: true }).eq("status", "finalized"),
      supabase.from("self_audit_historical_audits").select("id", { count: "exact", head: true }).eq("audit_type", "internal_audit"),
    ]);

  const openCycle = openCycles?.[0] ?? null;
  let submittedBranches = 0;
  let totalBranches = 0;
  if (openCycle) {
    const { data: assignments } = await supabase
      .from("self_audit_audit_assignments")
      .select("branch_id, status")
      .eq("cycle_id", openCycle.id);
    const byBranch = new Map<string, boolean>();
    for (const a of assignments ?? []) {
      const done = a.status !== "not_started" && a.status !== "in_progress";
      byBranch.set(a.branch_id, (byBranch.get(a.branch_id) ?? true) && done);
    }
    totalBranches = byBranch.size;
    submittedBranches = [...byBranch.values()].filter(Boolean).length;
  }
  const daysLeft = daysUntil(openCycle?.deadline_at ?? null);

  return (
    <section aria-label="Audit folders" className="grid gap-4 md:grid-cols-2">
      <Folder
        title="Self Audit"
        description="Monthly branch self-audit: generate cycles, follow submissions and review them."
        icon={<ClipboardIcon />}
        stats={
          openCycle
            ? [
                { label: `${monthLabel(openCycle.cycle_month)} cycle`, tone: "good" },
                { label: `${submittedBranches} of ${totalBranches} branches submitted` },
                daysLeft == null ? null : daysLeft >= 0 ? { label: `${daysLeft} day${daysLeft === 1 ? "" : "s"} left` } : { label: "Past deadline", tone: "warn" as const },
              ]
            : [{ label: "No open cycle" }]
        }
        openHref="/admin/cycles"
        openLabel="Open self audit"
        resultsHref="/admin/results/self-audit"
        resultsCount={(selfResults ?? 0) + (selfHistorical ?? 0)}
      />
      <Folder
        title="Internal Audit"
        description="Officer-led claim sampling across Documents, Parts and Branch Operation checkpoints."
        icon={<SearchIcon />}
        stats={[
          { label: `${inProgress ?? 0} in progress`, tone: (inProgress ?? 0) > 0 ? "warn" : undefined },
          { label: `${finalized ?? 0} finalized` },
        ]}
        openHref="/admin/internal-audit"
        openLabel="Open internal audit"
        resultsHref="/admin/results/internal-audit"
        resultsCount={(finalized ?? 0) + (intHistorical ?? 0)}
      />
    </section>
  );
}

type Stat = { label: string; tone?: "good" | "warn" } | null;

function Folder({
  title,
  description,
  icon,
  stats,
  openHref,
  openLabel,
  resultsHref,
  resultsCount,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  stats: Stat[];
  openHref: string;
  openLabel: string;
  resultsHref: string;
  resultsCount: number;
}) {
  return (
    <div className="group relative flex flex-col gap-4 rounded-2xl border border-neutral-200/70 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md has-[a:focus-visible]:border-brand/40">
      <div className="flex items-start gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand ring-1 ring-brand/15">{icon}</span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-neutral-900">{title}</h2>
          <p className="mt-0.5 text-sm text-neutral-600">{description}</p>
        </div>
      </div>

      <ul className="flex flex-wrap gap-1.5">
        {stats.map((s) =>
          s ? (
            <li
              key={s.label}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                s.tone === "good"
                  ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                  : s.tone === "warn"
                    ? "bg-amber-50 text-amber-800 ring-amber-200"
                    : "bg-neutral-100 text-neutral-700 ring-neutral-200"
              }`}
            >
              {s.label}
            </li>
          ) : null
        )}
      </ul>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-4">
        {/* The ::after stretches this link over the whole card, so a click anywhere opens the folder. */}
        <Link
          href={openHref}
          className="rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition after:absolute after:inset-0 after:rounded-2xl hover:bg-brand-dark hover:shadow-md"
        >
          {openLabel}
        </Link>
        <Link
          href={resultsHref}
          className="relative z-10 rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50"
        >
          Results <span className="ml-1 text-neutral-500">({resultsCount})</span>
        </Link>
      </div>
    </div>
  );
}

function ClipboardIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 4.5h6v2.5H9z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8.5 12l2 2 4-4.5M8.5 17.5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="5.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M15 15l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8.5 10.5l1.6 1.6 2.9-3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
