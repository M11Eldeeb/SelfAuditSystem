import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Month folders, same pattern as /admin/warranty-room/scrap and /destroy-evidence - keyed on collection_date (falls back to created_at for older rows uploaded before a date was set). */
export default async function SupplierPartsMonthsPage() {
  await requireRole("officer");
  const supabase = await createClient();

  const { data: collections } = await supabase
    .from("self_audit_supplier_collections")
    .select("collection_date, created_at");

  const countByMonth = new Map<string, number>();
  (collections ?? []).forEach((c) => {
    const key = (c.collection_date ?? c.created_at).slice(0, 7);
    countByMonth.set(key, (countByMonth.get(key) ?? 0) + 1);
  });

  const months = [...countByMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/warranty-room" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to Warranty Room
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">Supplier parts</h1>
        <p className="text-sm text-neutral-600">Grouped by collection month, then by branch.</p>
      </div>

      {months.length === 0 && (
        <p className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 text-sm text-neutral-400">
          No supplier collections uploaded yet.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {months.map(([month, count]) => {
          const [year, m] = month.split("-").map(Number);
          const label = `${MONTH_NAMES[m - 1]} ${year}`;
          return (
            <Link
              key={month}
              href={`/admin/warranty-room/supplier-parts/${month}`}
              className="flex flex-col gap-1 rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 transition hover:border-brand hover:shadow-md hover:-translate-y-0.5"
            >
              <p className="text-sm font-semibold text-neutral-900">{label}</p>
              <p className="text-xs text-neutral-500">{count} collection(s)</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
