import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function ScrapMonthPage({ params }: { params: Promise<{ month: string }> }) {
  await requireRole("officer");
  const { month } = await params;
  if (!/^\d{4}-\d{2}$/.test(month)) notFound();

  const supabase = await createClient();
  const [rangeYear, rangeMonth] = month.split("-").map(Number);
  const rangeStart = `${month}-01`;
  // Exclusive upper bound (first day of the next month) - "YYYY-MM-31" isn't
  // a valid date for every month (e.g. September has 30 days), so this
  // can't just be the same month with a fixed day-of-month tacked on.
  const rangeEnd = new Date(Date.UTC(rangeYear, rangeMonth, 1)).toISOString().slice(0, 10);

  const { data: requests } = await supabase
    .from("self_audit_scrap_requests")
    .select("branch_id")
    .eq("status", "scrapped")
    .gte("submitted_at", rangeStart)
    .lt("submitted_at", rangeEnd);

  const branchIds = [...new Set((requests ?? []).map((r) => r.branch_id))];
  const { data: branches } = branchIds.length
    ? await supabase.from("self_audit_branches").select("id, name").in("id", branchIds)
    : { data: [] };
  const branchNameById = new Map((branches ?? []).map((b) => [b.id, b.name]));

  const countByBranch = new Map<string, number>();
  (requests ?? []).forEach((r) => countByBranch.set(r.branch_id, (countByBranch.get(r.branch_id) ?? 0) + 1));

  const [year, m] = month.split("-").map(Number);
  const label = `${MONTH_NAMES[m - 1]} ${year}`;
  const branchEntries = [...countByBranch.entries()].sort((a, b) =>
    (branchNameById.get(a[0]) ?? "").localeCompare(branchNameById.get(b[0]) ?? "")
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/warranty-room/scrap" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to months
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">{label}</h1>
        <p className="text-sm text-neutral-600">Pick a branch to see its destruction videos.</p>
      </div>

      {branchEntries.length === 0 && (
        <p className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 text-sm text-neutral-400">
          Nothing submitted this month.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {branchEntries.map(([branchId, count]) => (
          <Link
            key={branchId}
            href={`/admin/warranty-room/scrap/${month}/${branchId}`}
            className="flex flex-col gap-1 rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 transition hover:border-brand hover:shadow-md hover:-translate-y-0.5"
          >
            <p className="text-sm font-semibold text-neutral-900">{branchNameById.get(branchId) ?? "Unknown branch"}</p>
            <p className="text-xs text-neutral-500">{count} claim(s)</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
