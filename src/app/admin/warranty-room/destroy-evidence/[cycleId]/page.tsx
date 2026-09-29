import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getWarrantyRoomFileUrl } from "@/lib/warranty-room/file-url";
import { MarkSentButton } from "../mark-sent-button";
import { ReturnButton } from "../return-button";
import { DownloadAllButton } from "../download-all-button";

export default async function DestroyEvidenceCyclePage({ params }: { params: Promise<{ cycleId: string }> }) {
  await requireRole("officer");
  const { cycleId } = await params;

  const supabase = await createClient();
  const { data: cycle } = await supabase.from("self_audit_audit_cycles").select("id, cycle_month").eq("id", cycleId).single();
  if (!cycle) notFound();

  const { data: evidence } = await supabase
    .from("self_audit_destroy_evidence")
    .select("branch_id, status, submitted_at, sent_at")
    .eq("cycle_id", cycleId)
    .in("status", ["submitted", "sent"])
    .order("submitted_at", { ascending: false });

  const branchIds = (evidence ?? []).map((e) => e.branch_id);
  const [{ data: branches }, { data: videos }] = await Promise.all([
    branchIds.length ? supabase.from("self_audit_branches").select("id, name").in("id", branchIds) : Promise.resolve({ data: [] }),
    branchIds.length
      ? supabase.from("self_audit_destroy_evidence_videos").select("branch_id, video_path").eq("cycle_id", cycleId).in("branch_id", branchIds)
      : Promise.resolve({ data: [] }),
  ]);
  const branchNameById = new Map((branches ?? []).map((b) => [b.id, b.name]));

  const videoUrlsByBranchId = new Map<string, { path: string; url: string | null }[]>();
  for (const v of videos ?? []) {
    const list = videoUrlsByBranchId.get(v.branch_id) ?? [];
    list.push({ path: v.video_path, url: await getWarrantyRoomFileUrl(supabase, v.video_path) });
    videoUrlsByBranchId.set(v.branch_id, list);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/warranty-room/destroy-evidence" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to cycles
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">{cycle.cycle_month.slice(0, 7)}</h1>
        <p className="text-sm text-neutral-600">Download each branch&apos;s videos, then mark as sent.</p>
      </div>

      {(evidence ?? []).length === 0 && (
        <p className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 text-sm text-neutral-400">
          Nothing here.
        </p>
      )}

      <div className="space-y-3">
        {(evidence ?? []).map((e) => {
          const branchVideos = videoUrlsByBranchId.get(e.branch_id) ?? [];
          return (
            <div key={e.branch_id} className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-neutral-900">{branchNameById.get(e.branch_id) ?? "Unknown branch"}</p>
                  <p className="text-xs text-neutral-500">
                    {e.status === "sent"
                      ? `Collected ${e.sent_at ? new Date(e.sent_at).toLocaleString() : ""}`
                      : `Submitted ${e.submitted_at ? new Date(e.submitted_at).toLocaleString() : ""}`}
                  </p>
                </div>
                {e.status === "submitted" && (
                  <div className="flex items-start gap-3">
                    <ReturnButton cycleId={cycleId} branchId={e.branch_id} />
                    <MarkSentButton cycleId={cycleId} branchId={e.branch_id} />
                  </div>
                )}
              </div>

              {branchVideos.length > 0 ? (
                <div className="flex flex-wrap items-center gap-3">
                  <DownloadAllButton urls={branchVideos.map((v) => v.url).filter((u): u is string => !!u)} />
                  {branchVideos.map((v, i) =>
                    v.url ? (
                      <a
                        key={v.path}
                        href={v.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium text-brand hover:underline"
                      >
                        Video {branchVideos.length > 1 ? i + 1 : ""} →
                      </a>
                    ) : (
                      <span key={v.path} className="text-sm text-neutral-400">
                        Video {i + 1} unavailable
                      </span>
                    )
                  )}
                </div>
              ) : (
                <p className="text-sm text-neutral-400">{e.status === "sent" ? "Already collected." : "No videos."}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
