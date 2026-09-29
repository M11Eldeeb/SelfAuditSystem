import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getWarrantyRoomFileUrl } from "@/lib/warranty-room/file-url";

export default async function ScrapDownloadsPage() {
  await requireRole("officer");
  const supabase = await createClient();

  const { data: requests } = await supabase
    .from("self_audit_scrap_requests")
    .select("id, claim_id, branch_id, work_order_no, video_path, submitted_at, holding_period_days")
    .eq("status", "scrapped")
    .order("submitted_at", { ascending: false });

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Scrap destruction videos</h1>
        <p className="text-sm text-neutral-600">
          Every branch that submitted a destruction video. Download and submit each one through the
          manufacturer&apos;s portal separately - nothing here needs approval or rejection.
        </p>
      </div>

      {(requests ?? []).length === 0 && (
        <p className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 text-sm text-neutral-400">
          No destruction videos submitted yet.
        </p>
      )}

      <div className="space-y-3">
        {(requests ?? []).map((r) => (
          <div key={r.id} className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium text-neutral-900">
                  Claim {claimNumberById.get(r.claim_id) ?? r.claim_id}
                  <span className="ml-2 text-sm font-normal text-neutral-500">{branchNameById.get(r.branch_id) ?? "Unknown branch"}</span>
                </p>
                <p className="text-xs text-neutral-500">
                  {r.work_order_no ?? "—"} &middot; submitted {r.submitted_at ? new Date(r.submitted_at).toLocaleString() : "—"}
                </p>
              </div>
              {r.holding_period_days != null && (
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                  {r.holding_period_days} day(s) held
                </span>
              )}
            </div>

            <ul className="text-sm text-neutral-700">
              {(partsByRequestId.get(r.id) ?? []).map((p, i) => (
                <li key={i}>
                  {p.part_name ?? p.part_no} {p.part_no && p.part_name && `(${p.part_no})`}
                  {p.quantity != null ? ` × ${p.quantity}` : ""}
                </li>
              ))}
            </ul>

            {videoUrlByRequestId.get(r.id) ? (
              <a
                href={videoUrlByRequestId.get(r.id) ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-sm font-medium text-brand hover:underline"
              >
                Download video →
              </a>
            ) : (
              <p className="text-sm text-neutral-400">Video unavailable.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
