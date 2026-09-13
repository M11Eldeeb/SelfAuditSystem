import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ScrapRequestCard } from "./scrap-request-card";

const PENDING_BRANCH_STATUSES = ["pending_branch", "returned_to_branch", "manufacturer_returned"];

export default async function BranchWarrantyRoomPage() {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();

  const { data: requests } = await supabase
    .from("self_audit_scrap_requests")
    .select("id, claim_id, work_order_no, status")
    .eq("branch_id", user.branch_id ?? "")
    .in("status", PENDING_BRANCH_STATUSES)
    .order("created_at", { ascending: true });

  const requestIds = (requests ?? []).map((r) => r.id);
  const claimIds = (requests ?? []).map((r) => r.claim_id);

  const [{ data: claims }, { data: parts }, { data: events }] = await Promise.all([
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Warranty Room</h1>
        <p className="text-sm text-neutral-600">Claims flagged to have their removed parts scrapped.</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Parts to scrap</h2>
        {(requests ?? []).length === 0 && (
          <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-400">
            Nothing pending right now.
          </p>
        )}
        {(requests ?? []).map((r) => (
          <ScrapRequestCard
            key={r.id}
            requestId={r.id}
            claimNumber={claimNumberById.get(r.claim_id) ?? r.claim_id}
            workOrderNo={r.work_order_no}
            status={r.status}
            parts={partsByRequestId.get(r.id) ?? []}
            lastComment={lastCommentByRequestId.get(r.id) ?? null}
          />
        ))}
      </section>
    </div>
  );
}
