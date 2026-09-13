import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getWarrantyRoomFileUrl } from "@/lib/warranty-room/file-url";
import { ScrapReviewCard } from "./scrap-review-card";

export default async function ScrapReviewPage() {
  await requireRole("officer");
  const supabase = await createClient();

  const { data: requests } = await supabase
    .from("self_audit_scrap_requests")
    .select("id, claim_id, branch_id, work_order_no, status, video_path")
    .in("status", ["pending_review", "pending_manufacturer"])
    .order("submitted_at", { ascending: true });

  const claimIds = (requests ?? []).map((r) => r.claim_id);
  const branchIds = (requests ?? []).map((r) => r.branch_id);
  const requestIds = (requests ?? []).map((r) => r.id);

  const [{ data: claims }, { data: branches }, { data: parts }] = await Promise.all([
    claimIds.length ? supabase.from("self_audit_claims").select("id, claim_number").in("id", claimIds) : Promise.resolve({ data: [] }),
    branchIds.length ? supabase.from("self_audit_branches").select("id, name").in("id", branchIds) : Promise.resolve({ data: [] }),
    requestIds.length
      ? supabase.from("self_audit_scrap_request_parts").select("scrap_request_id, part_no, part_name, quantity").in("scrap_request_id", requestIds)
      : Promise.resolve({ data: [] }),
  ]);

  const claimNumberById = new Map((claims ?? []).map((c) => [c.id, c.claim_number]));
  const branchNameById = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const partsByRequestId = new Map<string, { part_no: string; part_name: string | null; quantity: number | null }[]>();
  (parts ?? []).forEach((p) => {
    const list = partsByRequestId.get(p.scrap_request_id) ?? [];
    list.push(p);
    partsByRequestId.set(p.scrap_request_id, list);
  });

  const videoUrlByRequestId = new Map<string, string | null>();
  for (const r of requests ?? []) {
    videoUrlByRequestId.set(r.id, await getWarrantyRoomFileUrl(supabase, r.video_path));
  }

  const reviewQueue = (requests ?? []).filter((r) => r.status === "pending_review");
  const manufacturerQueue = (requests ?? []).filter((r) => r.status === "pending_manufacturer");

  const renderCard = (r: NonNullable<typeof requests>[number], stage: "review" | "manufacturer") => (
    <ScrapReviewCard
      key={r.id}
      requestId={r.id}
      claimNumber={claimNumberById.get(r.claim_id) ?? r.claim_id}
      workOrderNo={r.work_order_no}
      branchName={branchNameById.get(r.branch_id) ?? "Unknown branch"}
      videoUrl={videoUrlByRequestId.get(r.id) ?? null}
      parts={partsByRequestId.get(r.id) ?? []}
      stage={stage}
    />
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Scrap review</h1>
        <p className="text-sm text-neutral-600">Branch destruction submissions awaiting review or manufacturer decision.</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Awaiting your review</h2>
        {reviewQueue.length === 0 && (
          <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-400">Nothing pending review.</p>
        )}
        {reviewQueue.map((r) => renderCard(r, "review"))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Awaiting manufacturer decision</h2>
        {manufacturerQueue.length === 0 && (
          <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-400">Nothing pending.</p>
        )}
        {manufacturerQueue.map((r) => renderCard(r, "manufacturer"))}
      </section>
    </div>
  );
}
