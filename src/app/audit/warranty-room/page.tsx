import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFirstSubmitDate, computeHoldingPeriodDays } from "@/lib/warranty-room/claim-dates";
import { ScrapRequestsTable } from "./scrap-requests-table";
import { SupplierCollectionCard } from "./supplier-collection-card";
import { BulkScrapVideoUpload } from "./bulk-scrap-video-upload";

type ClaimEmbed = {
  claim_number: string;
  raw_row: Record<string, unknown> | null;
  repair_end_date: string | null;
} | null;

type ScrapRequestRow = {
  id: string;
  claim_id: string;
  work_order_no: string | null;
  status: string;
  self_audit_claims: ClaimEmbed;
  self_audit_scrap_request_parts: { part_no: string; part_name: string | null; quantity: number | null }[];
  self_audit_scrap_request_events: { event_type: string; comment: string | null; created_at: string }[];
};

type CollectionRow = {
  id: string;
  collection_date: string | null;
  self_audit_supplier_collection_parts: {
    work_order_no: string | null;
    vin: string | null;
    part_no: string | null;
    part_name: string | null;
    quantity: number | null;
    main_labor_name: string | null;
    planned_pickup_date: string | null;
    raw_row: Record<string, unknown> | null;
    self_audit_claims: ClaimEmbed;
  }[];
};

export default async function BranchWarrantyRoomPage() {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();

  // Fetch each table's related rows via a single PostgREST-embedded query
  // (FK-based join) instead of a separate .in(ids) lookup. Some branches now
  // carry hundreds of pending scrap_requests (bulk-flagged by the cron job),
  // and a .in() list that long silently failed - past the request pipeline's
  // URL/query-length limit, with the error never checked - leaving every
  // derived field blank and claim_number falling back to the raw UUID.
  const [{ data: requestsRaw, error: requestsError }, { data: branch }, { data: collectionsRaw, error: collectionsError }] = await Promise.all([
    supabase
      .from("self_audit_scrap_requests")
      .select(
        `id, claim_id, work_order_no, status,
         self_audit_claims ( claim_number, raw_row, repair_end_date ),
         self_audit_scrap_request_parts ( part_no, part_name, quantity ),
         self_audit_scrap_request_events ( event_type, comment, created_at )`
      )
      .eq("branch_id", user.branch_id ?? "")
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    supabase.from("self_audit_branches").select("name").eq("id", user.branch_id ?? "").single(),
    supabase
      .from("self_audit_supplier_collections")
      .select(
        `id, collection_date,
         self_audit_supplier_collection_parts (
           work_order_no, vin, part_no, part_name, quantity, main_labor_name, planned_pickup_date, raw_row,
           self_audit_claims ( claim_number, raw_row, repair_end_date )
         )`
      )
      .eq("branch_id", user.branch_id ?? "")
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
  ]);

  if (requestsError) throw new Error(`Failed to load scrap requests: ${requestsError.message}`);
  if (collectionsError) throw new Error(`Failed to load supplier collections: ${collectionsError.message}`);

  const requests = (requestsRaw ?? []) as unknown as ScrapRequestRow[];
  const collections = (collectionsRaw ?? []) as unknown as CollectionRow[];

  const lastCommentByRequestId = new Map<string, string>();
  requests.forEach((r) => {
    const sorted = [...r.self_audit_scrap_request_events].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const withComment = sorted.find((e) => e.comment);
    if (withComment?.comment) lastCommentByRequestId.set(r.id, withComment.comment);
  });

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
      first_submit_date: string | null;
      repair_end_date: string | null;
      holding_period_days: number | null;
    }[]
  >();
  collections.forEach((c) => {
    const list = c.self_audit_supplier_collection_parts.map((p) => {
      const claim = p.self_audit_claims;
      const claimRawRow = claim?.raw_row;
      return {
        claim_number: claim?.claim_number ?? "—",
        work_order_no: p.work_order_no,
        vin: p.vin,
        part_no: p.part_no,
        part_name: p.part_name,
        quantity: p.quantity,
        main_labor_name: p.main_labor_name,
        planned_pickup_date: p.planned_pickup_date,
        raw_row: p.raw_row,
        first_submit_date: getFirstSubmitDate(claimRawRow),
        repair_end_date: claim?.repair_end_date ?? null,
        holding_period_days: computeHoldingPeriodDays(claimRawRow),
      };
    });
    collectionPartsByCollectionId.set(c.id, list);
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
          requests={requests.map((r) => ({
            id: r.id,
            claimNumber: r.self_audit_claims?.claim_number ?? r.claim_id,
            workOrderNo: r.work_order_no,
          }))}
        />
        <ScrapRequestsTable
          branchName={branch?.name ?? ""}
          requests={requests.map((r) => {
            const claimRawRow = r.self_audit_claims?.raw_row;
            return {
              id: r.id,
              claimNumber: r.self_audit_claims?.claim_number ?? r.claim_id,
              workOrderNo: r.work_order_no,
              status: r.status,
              parts: r.self_audit_scrap_request_parts,
              lastComment: lastCommentByRequestId.get(r.id) ?? null,
              firstSubmitDate: getFirstSubmitDate(claimRawRow),
              repairEndDate: r.self_audit_claims?.repair_end_date ?? null,
              holdingPeriodDays: computeHoldingPeriodDays(claimRawRow),
            };
          })}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Supplier parts</h2>
        {collections.length === 0 && (
          <p className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 text-sm text-neutral-400">
            Nothing pending right now.
          </p>
        )}
        <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
          {collections.map((c) => (
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

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
          <Link href="/audit/warranty-room/already-scrapped" className="text-sm font-medium text-brand hover:underline">
            Already scrapped list →
          </Link>
          <p className="mt-1 text-xs text-neutral-500">Claims no longer pending - video submitted, or holding period exceeded in an earlier upload.</p>
        </div>
        <div className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
          <Link href="/audit/warranty-room/do-not-scrap" className="text-sm font-medium text-brand hover:underline">
            Do not scrap list →
          </Link>
          <p className="mt-1 text-xs text-neutral-500">Claims to keep on hand - not flagged to scrap, not already scrapped.</p>
        </div>
      </section>
    </div>
  );
}
