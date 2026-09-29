import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getWarrantyRoomFileUrl } from "@/lib/warranty-room/file-url";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function ScrapMonthBranchPage({
  params,
}: {
  params: Promise<{ month: string; branchId: string }>;
}) {
  await requireRole("officer");
  const { month, branchId } = await params;
  if (!/^\d{4}-\d{2}$/.test(month)) notFound();

  const supabase = await createClient();
  const { data: branch } = await supabase.from("self_audit_branches").select("id, name").eq("id", branchId).single();
  if (!branch) notFound();

  const [rangeYear, rangeMonth] = month.split("-").map(Number);
  const rangeStart = `${month}-01`;
  const rangeEnd = new Date(Date.UTC(rangeYear, rangeMonth, 1)).toISOString().slice(0, 10);

  const { data: requests } = await supabase
    .from("self_audit_scrap_requests")
    .select("id, claim_id, work_order_no, submitted_at, holding_period_days")
    .eq("branch_id", branchId)
    .eq("status", "scrapped")
    .gte("submitted_at", rangeStart)
    .lt("submitted_at", rangeEnd)
    .order("submitted_at", { ascending: false });

  const claimIds = (requests ?? []).map((r) => r.claim_id);
  const requestIds = (requests ?? []).map((r) => r.id);

  const [{ data: claims }, { data: parts }, { data: videos }] = await Promise.all([
    claimIds.length ? supabase.from("self_audit_claims").select("id, claim_number").in("id", claimIds) : Promise.resolve({ data: [] }),
    requestIds.length
      ? supabase.from("self_audit_scrap_request_parts").select("scrap_request_id, part_no, part_name, quantity").in("scrap_request_id", requestIds)
      : Promise.resolve({ data: [] }),
    requestIds.length
      ? supabase.from("self_audit_scrap_request_videos").select("scrap_request_id, video_path").in("scrap_request_id", requestIds)
      : Promise.resolve({ data: [] }),
  ]);

  const claimNumberById = new Map((claims ?? []).map((c) => [c.id, c.claim_number]));
  const partsByRequestId = new Map<string, { part_no: string; part_name: string | null; quantity: number | null }[]>();
  (parts ?? []).forEach((p) => {
    const list = partsByRequestId.get(p.scrap_request_id) ?? [];
    list.push(p);
    partsByRequestId.set(p.scrap_request_id, list);
  });

  const videoUrlsByRequestId = new Map<string, { path: string; url: string | null }[]>();
  for (const v of videos ?? []) {
    const list = videoUrlsByRequestId.get(v.scrap_request_id) ?? [];
    list.push({ path: v.video_path, url: await getWarrantyRoomFileUrl(supabase, v.video_path) });
    videoUrlsByRequestId.set(v.scrap_request_id, list);
  }

  const [year, m] = month.split("-").map(Number);
  const label = `${MONTH_NAMES[m - 1]} ${year}`;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/admin/warranty-room/scrap/${month}`} className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to {label}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">{branch.name}</h1>
        <p className="text-sm text-neutral-600">{label} destruction videos.</p>
      </div>

      {(requests ?? []).length === 0 && (
        <p className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 text-sm text-neutral-400">
          Nothing here.
        </p>
      )}

      <div className="space-y-3">
        {(requests ?? []).map((r) => {
          const requestVideos = videoUrlsByRequestId.get(r.id) ?? [];
          return (
            <div key={r.id} className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-neutral-900">Claim {claimNumberById.get(r.claim_id) ?? r.claim_id}</p>
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

              {requestVideos.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {requestVideos.map((v, i) =>
                    v.url ? (
                      <a
                        key={v.path}
                        href={v.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium text-brand hover:underline"
                      >
                        Download video {requestVideos.length > 1 ? i + 1 : ""} →
                      </a>
                    ) : (
                      <span key={v.path} className="text-sm text-neutral-400">
                        Video {i + 1} unavailable
                      </span>
                    )
                  )}
                </div>
              ) : (
                <p className="text-sm text-neutral-400">No videos.</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
