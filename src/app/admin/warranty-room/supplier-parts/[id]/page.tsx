import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isSupplierPartOverdue } from "@/lib/warranty-room/supplier-overdue";
import { DownloadExcelButton } from "./download-button";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  signed_uploaded: "Signed",
  handed_over: "Handed over",
};

export default async function SupplierCollectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("officer");
  const supabase = await createClient();
  const { id } = await params;

  const { data: collection } = await supabase
    .from("self_audit_supplier_collections")
    .select("id, branch_id, collection_date, status, branch_rep_name, supplier_rep_name, handed_over_at")
    .eq("id", id)
    .maybeSingle();
  if (!collection) notFound();

  const [{ data: branch }, { data: parts }] = await Promise.all([
    supabase.from("self_audit_branches").select("name").eq("id", collection.branch_id).single(),
    supabase
      .from("self_audit_supplier_collection_parts")
      .select("claim_id, work_order_no, vin, part_no, part_name, quantity, main_labor_name, planned_pickup_date, raw_row")
      .eq("collection_id", id),
  ]);

  const claimIds = [...new Set((parts ?? []).map((p) => p.claim_id).filter((id): id is string => !!id))];
  const { data: claims } = claimIds.length
    ? await supabase.from("self_audit_claims").select("id, claim_number, raw_row").in("id", claimIds)
    : { data: [] };
  const claimById = new Map((claims ?? []).map((c) => [c.id, c]));

  const branchName = branch?.name ?? "Unknown branch";
  const rows = (parts ?? []).map((p) => {
    const claim = p.claim_id ? claimById.get(p.claim_id) : undefined;
    return {
      claim_number: claim?.claim_number ?? "—",
      work_order_no: p.work_order_no,
      vin: p.vin,
      part_no: p.part_no,
      part_name: p.part_name,
      quantity: p.quantity,
      main_labor_name: p.main_labor_name,
      planned_pickup_date: p.planned_pickup_date,
      raw_row: p.raw_row as Record<string, unknown> | null,
      overdue: isSupplierPartOverdue(claim?.raw_row as Record<string, unknown> | null | undefined),
    };
  });
  const overdueCount = rows.filter((r) => r.overdue).length;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/warranty-room/supplier-parts" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to Supplier parts
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{branchName}</h1>
          <p className="text-sm text-neutral-600">
            Collection date: {collection.collection_date ?? "—"} &middot; Status: {STATUS_LABELS[collection.status] ?? collection.status}
            {collection.status === "handed_over" && collection.handed_over_at && ` · Handed over ${new Date(collection.handed_over_at).toLocaleDateString()}`}
          </p>
          {collection.status === "handed_over" && (
            <p className="text-sm text-neutral-600">
              {collection.branch_rep_name} (branch) &middot; {collection.supplier_rep_name} (supplier)
            </p>
          )}
          {overdueCount > 0 && (
            <p className="mt-1 text-xs font-medium text-amber-700">{overdueCount} part(s) more than 90 days overdue</p>
          )}
        </div>
        <DownloadExcelButton branchName={branchName} rows={rows} />
      </div>

      <div className="overflow-hidden rounded-md border border-neutral-200">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-1.5">Claim</th>
              <th className="px-3 py-1.5">Work order</th>
              <th className="px-3 py-1.5">Part</th>
              <th className="px-3 py-1.5">Qty</th>
              <th className="px-3 py-1.5">Planned pickup</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r, i) => (
              <tr key={i} className={r.overdue ? "bg-amber-50" : undefined}>
                <td className="px-3 py-1.5 text-neutral-900">
                  {r.claim_number}
                  {r.overdue && <span className="ml-2 text-xs font-medium text-amber-700">Overdue</span>}
                </td>
                <td className="px-3 py-1.5 text-neutral-600">{r.work_order_no ?? "—"}</td>
                <td className="px-3 py-1.5 text-neutral-600">
                  {r.part_name ?? r.part_no ?? "—"} {r.part_no && `(${r.part_no})`}
                </td>
                <td className="px-3 py-1.5 text-neutral-600">{r.quantity ?? "—"}</td>
                <td className="px-3 py-1.5 text-neutral-600">{r.planned_pickup_date ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-neutral-400">
                  No parts on file.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
