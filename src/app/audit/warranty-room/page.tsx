import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ScrapRequestsTable } from "./scrap-requests-table";
import { SupplierCollectionCard } from "./supplier-collection-card";
import { BulkScrapVideoUpload } from "./bulk-scrap-video-upload";

const PENDING_BRANCH_STATUSES = ["pending_branch", "returned_to_branch", "manufacturer_returned"];

export default async function BranchWarrantyRoomPage() {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();

  const [{ data: requests }, { data: branch }, { data: collections }] = await Promise.all([
    supabase
      .from("self_audit_scrap_requests")
      .select("id, claim_id, work_order_no, status")
      .eq("branch_id", user.branch_id ?? "")
      .in("status", PENDING_BRANCH_STATUSES)
      .order("created_at", { ascending: true }),
    supabase.from("self_audit_branches").select("name").eq("id", user.branch_id ?? "").single(),
    supabase
      .from("self_audit_supplier_collections")
      .select("id, collection_date")
      .eq("branch_id", user.branch_id ?? "")
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
  ]);

  const requestIds = (requests ?? []).map((r) => r.id);
  const claimIds = (requests ?? []).map((r) => r.claim_id);
  const collectionIds = (collections ?? []).map((c) => c.id);

  const [{ data: claims }, { data: parts }, { data: events }, { data: collectionParts }] = await Promise.all([
    claimIds.length
      ? supabase.from("self_audit_claims").select("id, claim_number").in("id", claimIds)
      : Promise.resolve({ data: [] }),
    requestIds.length
      ? supabase.from("self_audit_scrap_request_parts").select("scrap_request_id, part_no, part_name, quantity").in("scrap_request_id", requestIds)
      : Promise.resolve({ data: [] }),
    requestIds.length
      ? supabase
          .from("self_audit_scrap_request_events")
          .select("scrap_request_id, event_type, comment, created_at")
          .in("scrap_request_id", requestIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    collectionIds.length
      ? supabase
          .from("self_audit_supplier_collection_parts")
          .select("collection_id, work_order_no, vin, part_no, part_name, quantity, main_labor_name, planned_pickup_date, claim_id, raw_row")
          .in("collection_id", collectionIds)
      : Promise.resolve({ data: [] }),
  ]);

  const claimNumberById = new Map((claims ?? []).map((c) => [c.id, c.claim_number]));
  const partsByRequestId = new Map<string, { part_no: string; part_name: string | null; quantity: number | null }[]>();
  (parts ?? []).forEach((p) => {
    const list = partsByRequestId.get(p.scrap_request_id) ?? [];
    list.push(p);
    partsByRequestId.set(p.scrap_request_id, list);
  });
  const lastCommentByRequestId = new Map<string, string>();
  (events ?? []).forEach((e) => {
    if (!e.comment || lastCommentByRequestId.has(e.scrap_request_id)) return;
    lastCommentByRequestId.set(e.scrap_request_id, e.comment);
  });

  // Supplier collection parts don't store the claim number directly - look
  // it up via claim_id (they may reference claims outside this branch admin's
  // own claim fetch above, so resolve separately).
  const collectionClaimIds = [...new Set((collectionParts ?? []).map((p) => p.claim_id).filter((id): id is string => !!id))];
  const { data: collectionClaims } = collectionClaimIds.length
    ? await supabase.from("self_audit_claims").select("id, claim_number").in("id", collectionClaimIds)
    : { data: [] };
  const collectionClaimNumberById = new Map((collectionClaims ?? []).map((c) => [c.id, c.claim_number]));

  const collectionPartsByCollectionId = new Map<
    string,
    {
      claim_number: string;
      work_order_no: string | null;
      vin: string | null;
      part_no: string | null;
      part_name: string | null;
      quantity: number | null;
      main_labor_name: string | null;
      planned_pickup_date: string | null;
      raw_row: Record<string, unknown> | null;
    }[]
  >();
  (collectionParts ?? []).forEach((p) => {
    const list = collectionPartsByCollectionId.get(p.collection_id) ?? [];
    list.push({
      claim_number: p.claim_id ? (collectionClaimNumberById.get(p.claim_id) ?? "—") : "—",
      work_order_no: p.work_order_no,
      vin: p.vin,
      part_no: p.part_no,
      part_name: p.part_name,
      quantity: p.quantity,
      main_labor_name: p.main_labor_name,
      planned_pickup_date: p.planned_pickup_date,
      raw_row: p.raw_row,
    });
    collectionPartsByCollectionId.set(p.collection_id, list);
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Warranty Room</h1>
        <p className="text-sm text-neutral-600">Claims flagged to have their removed parts scrapped, or reserved for the manufacturer&apos;s supplier to collect.</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Parts to scrap</h2>
        <BulkScrapVideoUpload
          requests={(requests ?? []).map((r) => ({
            id: r.id,
            claimNumber: claimNumberById.get(r.claim_id) ?? r.claim_id,
            workOrderNo: r.work_order_no,
          }))}
        />
        <ScrapRequestsTable
          branchName={branch?.name ?? ""}
          requests={(requests ?? []).map((r) => ({
            id: r.id,
            claimNumber: claimNumberById.get(r.claim_id) ?? r.claim_id,
            workOrderNo: r.work_order_no,
            status: r.status,
            parts: partsByRequestId.get(r.id) ?? [],
            lastComment: lastCommentByRequestId.get(r.id) ?? null,
          }))}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Supplier parts</h2>
        {(collections ?? []).length === 0 && (
          <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-400">
            Nothing pending right now.
          </p>
        )}
        <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
          {(collections ?? []).map((c) => (
            <SupplierCollectionCard
              key={c.id}
              collectionId={c.id}
              branchName={branch?.name ?? ""}
              collectionDateLabel={c.collection_date ?? "—"}
              parts={collectionPartsByCollectionId.get(c.id) ?? []}
            />
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <Link href="/audit/warranty-room/do-not-scrap" className="text-sm font-medium text-brand hover:underline">
          Do not scrap list →
        </Link>
        <p className="mt-1 text-xs text-neutral-500">Claims to keep on hand - not flagged to scrap, not already scrapped.</p>
      </section>
    </div>
  );
}
