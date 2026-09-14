import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isSupplierPartOverdue } from "@/lib/warranty-room/supplier-overdue";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  signed_uploaded: "Signed",
  handed_over: "Handed over",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-neutral-100 text-neutral-700",
  signed_uploaded: "bg-blue-100 text-blue-700",
  handed_over: "bg-emerald-100 text-emerald-700",
};

export default async function SupplierPartsMonitorPage() {
  await requireRole("officer");
  const supabase = await createClient();

  const { data: collections } = await supabase
    .from("self_audit_supplier_collections")
    .select("id, branch_id, collection_date, status")
    .order("created_at", { ascending: false });

  const branchIds = [...new Set((collections ?? []).map((c) => c.branch_id))];
  const collectionIds = (collections ?? []).map((c) => c.id);

  const [{ data: branches }, { data: parts }] = await Promise.all([
    branchIds.length ? supabase.from("self_audit_branches").select("id, name").in("id", branchIds) : Promise.resolve({ data: [] }),
    collectionIds.length
      ? supabase.from("self_audit_supplier_collection_parts").select("collection_id, claim_id").in("collection_id", collectionIds)
      : Promise.resolve({ data: [] }),
  ]);

  const branchNameById = new Map((branches ?? []).map((b) => [b.id, b.name]));

  const claimIds = [...new Set((parts ?? []).map((p) => p.claim_id).filter((id): id is string => !!id))];
  const { data: claims } = claimIds.length
    ? await supabase.from("self_audit_claims").select("id, raw_row").in("id", claimIds)
    : { data: [] };
  const claimById = new Map((claims ?? []).map((c) => [c.id, c]));

  const partCountByCollectionId = new Map<string, number>();
  const overdueCountByCollectionId = new Map<string, number>();
  (parts ?? []).forEach((p) => {
    partCountByCollectionId.set(p.collection_id, (partCountByCollectionId.get(p.collection_id) ?? 0) + 1);
    const claim = p.claim_id ? claimById.get(p.claim_id) : undefined;
    if (isSupplierPartOverdue(claim?.raw_row as Record<string, unknown> | null | undefined)) {
      overdueCountByCollectionId.set(p.collection_id, (overdueCountByCollectionId.get(p.collection_id) ?? 0) + 1);
    }
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/warranty-room" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to Warranty Room
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">Supplier parts</h1>
        <p className="text-sm text-neutral-600">
          Every uploaded collection, one per branch. Open a collection to see its parts - rows
          highlighted in amber there are more than 90 days past their claim&apos;s verification date.
        </p>
      </div>

      {(collections ?? []).length === 0 && (
        <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-400">No supplier collections uploaded yet.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(collections ?? []).map((c) => {
          const overdueCount = overdueCountByCollectionId.get(c.id) ?? 0;
          return (
            <Link
              key={c.id}
              href={`/admin/warranty-room/supplier-parts/${c.id}`}
              className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-4 transition hover:border-brand hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-neutral-900">{branchNameById.get(c.branch_id) ?? "Unknown branch"}</p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[c.status] ?? "bg-neutral-100 text-neutral-700"}`}>
                  {STATUS_LABELS[c.status] ?? c.status}
                </span>
              </div>
              <p className="text-xs text-neutral-500">Collection date: {c.collection_date ?? "—"}</p>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-neutral-600">{partCountByCollectionId.get(c.id) ?? 0} part(s)</span>
                {overdueCount > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">{overdueCount} overdue</span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
