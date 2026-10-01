import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function ScrapDownloadsPage() {
  await requireRole("officer");
  const supabase = await createClient();

  const { data: requests } = await supabase
    .from("self_audit_scrap_requests")
    .select("submitted_at")
    .eq("status", "scrapped");

  const countByMonth = new Map<string, number>();
  (requests ?? []).forEach((r) => {
    if (!r.submitted_at) return;
    const key = r.submitted_at.slice(0, 7); // YYYY-MM
    countByMonth.set(key, (countByMonth.get(key) ?? 0) + 1);
  });

  const months = [...countByMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/warranty-room" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to Warranty Room
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">Scrap destruction videos</h1>
        <p className="text-sm text-neutral-600">
          Grouped by the month submitted, then by branch. Download and submit each one through the
          manufacturer&apos;s portal separately - nothing here needs approval or rejection.
        </p>
      </div>

      {months.length === 0 && (
        <p className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 text-sm text-neutral-400">
          No destruction videos submitted yet.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {months.map(([month, count]) => {
          const [year, m] = month.split("-").map(Number);
          const label = `${MONTH_NAMES[m - 1]} ${year}`;
          return (
            <Link
              key={month}
              href={`/admin/warranty-room/scrap/${month}`}
              className="flex flex-col gap-1 rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 transition hover:border-brand hover:shadow-md hover:-translate-y-0.5"
            >
              <p className="text-sm font-semibold text-neutral-900">{label}</p>
              <p className="text-xs text-neutral-500">{count} claim(s)</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
