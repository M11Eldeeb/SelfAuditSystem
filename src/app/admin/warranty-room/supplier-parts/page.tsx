import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isSupplierPartOverdue } from "@/lib/warranty-room/supplier-overdue";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  signed_uploaded: "Signed",
  handed_over: "Handed over",
};

export default async function SupplierPartsMonitorPage() {
  await requireRole("officer");
  const supabase = await createClient();

  const { data: collections } = await supabase
    .from("self_audit_supplier_collections")
    .select("id, branch_id, collection_date, status, branch_rep_name, supplier_rep_name, handed_over_at")
    .order("created_at", { ascending: false });

  const branchIds = [...new Set((collections ?? []).map((c) => c.branch_id))];
  const collectionIds = (collections ?? []).map((c) => c.id);

  const [{ data: branches }, { data: parts }] = await Promise.all([
    branchIds.length ? supabase.from("self_audit_branches").select("id, name").in("id", branchIds) : Promise.resolve({ data: [] }),
    collectionIds.length
      ? supabase.from("self_audit_supplier_collection_parts").select("collection_id, claim_id, part_no, part_name").in("collection_id", collectionIds)
      : Promise.resolve({ data: [] }),
  ]);

  const branchNameById = new Map((branches ?? []).map((b) => [b.id, b.name]));

  const claimIds = [...new Set((parts ?? []).map((p) => p.claim_id).filter((id): id is string => !!id))];
  const { data: claims } = claimIds.length
    ? await supabase.from("self_audit_claims").select("id, claim_number, raw_row").in("id", claimIds)
    : { data: [] };
  const claimById = new Map((claims ?? []).map((c) => [c.id, c]));

  const partsByCollectionId = new Map<string, { claim_id: string | null; part_no: string | null; part_name: string | null }[]>();
  (parts ?? []).forEach((p) => {
    const list = partsByCollectionId.get(p.collection_id) ?? [];
    list.push(p);
    partsByCollectionId.set(p.collection_id, list);
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Supplier parts</h1>
        <p className="text-sm text-neutral-600">
          Every uploaded collection, grouped by branch. Rows highlighted in amber are more than 90 days
          past their claim&apos;s verification date (for claims Approved, Settled, or To Be Settled).
        </p>
      </div>

      {(collections ?? []).length === 0 && (
        <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-400">No supplier collections uploaded yet.</p>
      )}

      {(collections ?? []).map((c) => {
        const collectionParts = partsByCollectionId.get(c.id) ?? [];
        return (
          <div key={c.id} className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-neutral-900">{branchNameById.get(c.branch_id) ?? "Unknown branch"}</p>
                <p className="text-xs text-neutral-500">
                  Collection date: {c.collection_date ?? "—"} &middot; Status: {STATUS_LABELS[c.status] ?? c.status}
                  {c.status === "handed_over" && c.handed_over_at && ` · Handed over ${new Date(c.handed_over_at).toLocaleDateString()}`}
                </p>
                {c.status === "handed_over" && (
                  <p className="text-xs text-neutral-500">
                    {c.branch_rep_name} (branch) &middot; {c.supplier_rep_name} (supplier)
                  </p>
                )}
              </div>
            </div>
            <div className="overflow-hidden rounded-md border border-neutral-100">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
                  <tr>
                    <th className="px-3 py-1.5">Claim</th>
                    <th className="px-3 py-1.5">Part</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {collectionParts.map((p, i) => {
                    const claim = p.claim_id ? claimById.get(p.claim_id) : undefined;
                    const overdue = isSupplierPartOverdue(claim?.raw_row as Record<string, unknown> | null | undefined);
                    return (
                      <tr key={i} className={overdue ? "bg-amber-50" : undefined}>
                        <td className="px-3 py-1.5 text-neutral-900">
                          {claim?.claim_number ?? "—"}
                          {overdue && <span className="ml-2 text-xs font-medium text-amber-700">Overdue</span>}
                        </td>
                        <td className="px-3 py-1.5 text-neutral-600">
                          {p.part_name ?? p.part_no} ({p.part_no})
                        </td>
                      </tr>
                    );
                  })}
                  {collectionParts.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-3 py-3 text-center text-neutral-400">
                        No parts on file.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
