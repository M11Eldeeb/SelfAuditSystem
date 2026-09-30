import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFirstSubmitDate, computeHoldingPeriodDays } from "@/lib/warranty-room/claim-dates";
import { daysUntil } from "@/lib/cycle";
import { getWarrantyRoomFileUrl } from "@/lib/warranty-room/file-url";
import { SupplierCollectionCard } from "./supplier-collection-card";
import { SubmitDestroyEvidence } from "./submit-destroy-evidence";
import { ReportDownloadButton } from "@/components/report-download-button";
import { getFlaggedToScrapClaims } from "@/lib/warranty-room/flagged-to-scrap";

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
    // at most one open cycle at a time, so more than one row would throw.
    // Same "newest cycle_month that's open" resolution src/app/audit/page.tsx
    // uses for the self-audit cycle - this is Warranty Room's own, separate
    // cycle (self_audit_warranty_room_cycles), not tied to self-audit.
    supabase.from("self_audit_warranty_room_cycles").select("id, cycle_month, status").order("cycle_month", { ascending: false }),
  ]);

  if (collectionsError) throw new Error(`Failed to load supplier collections: ${collectionsError.message}`);
  const collections = (collectionsRaw ?? []) as unknown as CollectionRow[];
  const cycles = allCycles ?? [];
  const newestCycle = cycles[0] ?? null; // ordered cycle_month desc

  // One card per cycle this branch still has open business with - not just
  // the newest one. If October is never submitted and November's cycle gets
  // generated, October's card must keep showing (not get replaced by
  // November's), or that submission becomes permanently inaccessible.
  const [{ data: allDestroyEvidence }, { data: allDestroyEvidenceVideosRaw }] = await Promise.all([
    supabase.from("self_audit_destroy_evidence").select("cycle_id, status").eq("branch_id", branchId),
    supabase.from("self_audit_destroy_evidence_videos").select("id, cycle_id, video_path").eq("branch_id", branchId),
  ]);
  const destroyEvidenceByCycleId = new Map((allDestroyEvidence ?? []).map((e) => [e.cycle_id, e]));
  const destroyEvidenceVideosByCycleId = new Map<string, { id: string; path: string; url: string | null }[]>();
  for (const v of allDestroyEvidenceVideosRaw ?? []) {
    const list = destroyEvidenceVideosByCycleId.get(v.cycle_id) ?? [];
    list.push({ id: v.id, path: v.video_path, url: await getWarrantyRoomFileUrl(supabase, v.video_path) });
    destroyEvidenceVideosByCycleId.set(v.cycle_id, list);
  }

  const destroyEvidenceCycles = cycles.filter((c) => {
    if (c.id === newestCycle?.id) return true;
    const status = destroyEvidenceByCycleId.get(c.id)?.status;
    return status != null && status !== "sent";
  });

  const flaggedRows = await getFlaggedToScrapClaims(supabase, branchId);
  const waitingCount = flaggedRows.filter((r) => r.cycle_month !== newestCycle?.cycle_month).length;

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

      {waitingCount > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 shadow-sm p-4">
          <p className="text-sm font-medium text-amber-900">
            {waitingCount} part(s) still waiting for destroy evidence submission from an earlier cycle.
          </p>
          <p className="mt-1 text-xs text-amber-700">
            These stay flagged to scrap - they were never approved, so they weren&apos;t written off. Submit
            evidence for them along with this cycle&apos;s.
          </p>
        </div>
      )}

      {destroyEvidenceCycles.length > 0 && (
        <div className="space-y-3">
          {destroyEvidenceCycles.map((c) => (
            <SubmitDestroyEvidence
              key={c.id}
              cycleId={c.id}
              branchId={branchId}
              cycleMonthLabel={c.cycle_month.slice(0, 7)}
              status={(destroyEvidenceByCycleId.get(c.id)?.status as "pending" | "submitted" | "sent" | undefined) ?? "pending"}
              videos={destroyEvidenceVideosByCycleId.get(c.id) ?? []}
            />
          ))}
        </div>
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

      <section className="grid gap-3 sm:grid-cols-3">
        <ReportDownloadButton
          endpoint="/api/warranty-room/download/flagged-to-scrap"
          label="Flagged to be scrapped"
          description="Past 90 days held, awaiting destroy evidence and approval. Downloads as Excel."
          filenameFallback="Flagged_To_Scrap.xlsx"
        />
        <ReportDownloadButton
          endpoint="/api/warranty-room/download/scrapped-list"
          label="Scrapped list"
          description="Every claim already scrapped. Downloads as Excel."
          filenameFallback="Scrapped_List.xlsx"
        />
        <ReportDownloadButton
          endpoint="/api/warranty-room/download/do-not-scrap"
          label="Do not scrap list"
          description="Claims to keep on hand - not flagged to scrap, not already scrapped. Downloads as Excel."
          filenameFallback="Do_Not_Scrap.xlsx"
        />
      </section>
    </div>
  );
}
