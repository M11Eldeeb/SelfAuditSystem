import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFirstSubmitDate, computeHoldingPeriodDays } from "@/lib/warranty-room/claim-dates";
import { daysRemaining, daysUntil } from "@/lib/cycle";
import { getWarrantyRoomFileUrl } from "@/lib/warranty-room/file-url";
import { SupplierCollectionCard } from "./supplier-collection-card";
import { SubmitDestroyEvidence } from "./submit-destroy-evidence";
import { DoNotScrapDownloadButton } from "@/components/do-not-scrap-download-button";
import { ScrappingListDownloadButton } from "@/components/scrapping-list-download-button";

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
    self_audit_claims: {
      claim_number: string;
      raw_row: Record<string, unknown> | null;
      repair_end_date: string | null;
    } | null;
  }[];
};

export default async function BranchWarrantyRoomPage() {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();
  const branchId = user.branch_id ?? "";

  const [{ data: branch }, { data: collectionsRaw, error: collectionsError }, { data: allCycles }] = await Promise.all([
    supabase.from("self_audit_branches").select("name").eq("id", branchId).single(),
    supabase
      .from("self_audit_supplier_collections")
      .select(
        `id, collection_date,
         self_audit_supplier_collection_parts (
           work_order_no, vin, part_no, part_name, quantity, main_labor_name, planned_pickup_date, raw_row,
           self_audit_claims ( claim_number, raw_row, repair_end_date )
         )`
      )
      .eq("branch_id", branchId)
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    // Not .maybeSingle() on status='open' - nothing in the schema guarantees
    // at most one open cycle at a time (generateCycle never closes the
    // previous one), so more than one row would throw. Same "newest cycle_month
    // that's open" resolution src/app/audit/page.tsx already uses.
    supabase.from("self_audit_audit_cycles").select("id, cycle_month, deadline_at, status").order("cycle_month", { ascending: false }),
  ]);

  if (collectionsError) throw new Error(`Failed to load supplier collections: ${collectionsError.message}`);
  const collections = (collectionsRaw ?? []) as unknown as CollectionRow[];
  const currentCycle = (allCycles ?? []).find((c) => c.status === "open") ?? null;

  const [{ data: destroyEvidence }, { data: destroyEvidenceVideosRaw }] = currentCycle
    ? await Promise.all([
        supabase
          .from("self_audit_destroy_evidence")
          .select("status")
          .eq("cycle_id", currentCycle.id)
          .eq("branch_id", branchId)
          .maybeSingle(),
        supabase
          .from("self_audit_destroy_evidence_videos")
          .select("id, video_path")
          .eq("cycle_id", currentCycle.id)
          .eq("branch_id", branchId),
      ])
    : [{ data: null }, { data: null }];

  const destroyEvidenceVideos = await Promise.all(
    (destroyEvidenceVideosRaw ?? []).map(async (v) => ({
      id: v.id,
      path: v.video_path,
      url: await getWarrantyRoomFileUrl(supabase, v.video_path),
    }))
  );

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

      {currentCycle && (
        <SubmitDestroyEvidence
          cycleId={currentCycle.id}
          branchId={branchId}
          cycleMonthLabel={currentCycle.cycle_month.slice(0, 7)}
          daysLeft={daysRemaining(currentCycle.deadline_at)}
          status={(destroyEvidence?.status as "pending" | "submitted" | "sent" | undefined) ?? "pending"}
          videos={destroyEvidenceVideos}
        />
      )}

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
              collectionDaysLeft={daysUntil(c.collection_date)}
              parts={collectionPartsByCollectionId.get(c.id) ?? []}
            />
          ))}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <ScrappingListDownloadButton />
        <DoNotScrapDownloadButton />
      </section>
    </div>
  );
}
