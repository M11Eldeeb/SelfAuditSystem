import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getWarrantyRoomFileUrl } from "@/lib/warranty-room/file-url";
import {
  destroyEvidenceState,
  getFlaggedClaimCountsByCycleBranch,
  type DestroyEvidenceState,
} from "@/lib/warranty-room/destroy-evidence-status";
import { ApproveButton } from "../approve-button";
import { ReturnButton } from "../return-button";
import { DownloadAllButton } from "../download-all-button";
import { DeleteVideosButton } from "../delete-videos-button";

const STATE_ORDER: Record<DestroyEvidenceState, number> = { awaiting_approval: 0, not_submitted: 1, approved: 2 };
const STATE_BADGE: Record<DestroyEvidenceState, { label: string; className: string }> = {
  not_submitted: { label: "Not submitted", className: "bg-neutral-100 text-neutral-700 ring-neutral-200" },
  awaiting_approval: { label: "Awaiting approval", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  approved: { label: "Approved", className: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
};

export default async function DestroyEvidenceCyclePage({ params }: { params: Promise<{ cycleId: string }> }) {
  await requireRole("officer");
  const { cycleId } = await params;

  const supabase = await createClient();
  const { data: cycle } = await supabase.from("self_audit_warranty_room_cycles").select("id, cycle_month").eq("id", cycleId).single();
  if (!cycle) notFound();

  const [{ data: evidence }, flaggedByCycle, { data: videos }, { data: branches }] = await Promise.all([
    supabase.from("self_audit_destroy_evidence").select("branch_id, status, submitted_at, sent_at").eq("cycle_id", cycleId),
    getFlaggedClaimCountsByCycleBranch(supabase, cycleId),
    supabase.from("self_audit_destroy_evidence_videos").select("branch_id, video_path").eq("cycle_id", cycleId),
    supabase.from("self_audit_branches").select("id, name"),
  ]);
  const branchNameById = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const evidenceByBranchId = new Map((evidence ?? []).map((e) => [e.branch_id, e]));
  const flaggedCountByBranchId = flaggedByCycle.get(cycleId) ?? new Map<string, number>();

  // Every branch with claims flagged in this cycle, plus any with an
  // evidence row - so a branch that hasn't submitted still shows up.
  const branchIds = [...new Set([...flaggedCountByBranchId.keys(), ...evidenceByBranchId.keys()])];
  const rows = branchIds
    .map((branchId) => {
      const e = evidenceByBranchId.get(branchId);
      return {
        branchId,
        name: branchNameById.get(branchId) ?? "Unknown branch",
        state: destroyEvidenceState(e?.status),
        submittedAt: e?.submitted_at ?? null,
        sentAt: e?.sent_at ?? null,
        flaggedCount: flaggedCountByBranchId.get(branchId) ?? 0,
      };
    })
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name));

  const countByState = { not_submitted: 0, awaiting_approval: 0, approved: 0 };
  rows.forEach((r) => (countByState[r.state] += 1));

  const videoPathsByBranchId = new Map<string, { path: string; url: string | null }[]>();
  for (const v of videos ?? []) {
    const list = videoPathsByBranchId.get(v.branch_id) ?? [];
    list.push({ path: v.video_path, url: await getWarrantyRoomFileUrl(supabase, v.video_path) });
    videoPathsByBranchId.set(v.branch_id, list);
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/warranty-room/destroy-evidence" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to cycles
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">{cycle.cycle_month.slice(0, 7)}</h1>
        <p className="text-sm text-neutral-600">
          Download each branch&apos;s videos as a zip, then Approve (moves their flagged parts to the Already Scrapped List) or
          Return (sends it back for changes). Delete videos frees the storage once you have downloaded them.
        </p>
        <p className="mt-2 text-sm text-neutral-700">
          <span className="font-medium">{countByState.not_submitted}</span> not submitted ·{" "}
          <span className="font-medium">{countByState.awaiting_approval}</span> awaiting approval ·{" "}
          <span className="font-medium">{countByState.approved}</span> approved
        </p>
      </div>

      {rows.length === 0 && (
        <p className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 text-sm text-neutral-400">
          No branch has claims flagged in this cycle.
        </p>
      )}

      <div className="space-y-3">
        {rows.map((r) => {
          const branchVideos = videoPathsByBranchId.get(r.branchId) ?? [];
          const badge = STATE_BADGE[r.state];
          return (
            <div key={r.branchId} className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-neutral-900">{r.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${badge.className}`}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500">
                    {r.flaggedCount} claim(s) flagged
                    {r.state === "approved" && r.sentAt ? ` · Approved ${new Date(r.sentAt).toLocaleString()}` : ""}
                    {r.state === "awaiting_approval" && r.submittedAt ? ` · Submitted ${new Date(r.submittedAt).toLocaleString()}` : ""}
                    {r.state === "not_submitted" ? " · Waiting for the branch to submit" : ""}
                  </p>
                </div>
                {(r.state === "awaiting_approval" || branchVideos.length > 0) && (
                  <div className="flex items-start gap-3">
                    {r.state === "awaiting_approval" && <ReturnButton cycleId={cycleId} branchId={r.branchId} />}
                    {branchVideos.length > 0 && (
                      <DeleteVideosButton cycleId={cycleId} branchId={r.branchId} count={branchVideos.length} />
                    )}
                    {r.state === "awaiting_approval" && <ApproveButton cycleId={cycleId} branchId={r.branchId} />}
                  </div>
                )}
              </div>

              {branchVideos.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  <DownloadAllButton
                    zipName={`Destroy evidence - ${r.name} - ${cycle.cycle_month.slice(0, 7)}.zip`}
                    files={branchVideos.flatMap((v, i) =>
                      v.url ? [{ url: v.url, name: `Video ${i + 1}.${v.path.split(".").pop() || "mp4"}` }] : []
                    )}
                  />
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
              )}
              {branchVideos.length === 0 && r.state === "awaiting_approval" && (
                <p className="text-sm text-neutral-400">No videos (deleted).</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
