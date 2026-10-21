import Link from "next/link";
import type { TechClaimDetail } from "@/lib/tech-claims/server";
import { StatusPill, fmtDateTime } from "./status";
import { fmtBytes } from "./upload";
import { ReviewPanel } from "./review-panel";
import { TechClaimForm } from "./claim-form";

const EVENT_LABEL: Record<string, string> = {
  submitted: "Submitted",
  resubmitted: "Sent again",
  approved: "Approved",
  returned: "Returned to technician",
  rejected: "Rejected",
  edited: "Edited",
};

/**
 * One technician claim: details, the files (photos / videos inline, PDFs open), history - and, for whoever may act now,
 * the review buttons (warranty admin) or the correction form (technician).
 */
export function TechClaimDetailView({
  claim,
  backHref,
  canReview,
  canEdit,
  showDrive,
}: {
  claim: TechClaimDetail;
  backHref: string;
  canReview: boolean;
  canEdit: boolean;
  showDrive: boolean;
}) {
  const fileUrl = (id: string) => `/api/tech-claims/file/${id}`;
  const media = claim.fileList.filter((f) => f.mimeType.startsWith("image/") || f.mimeType.startsWith("video/"));
  const docs = claim.fileList.filter((f) => !media.includes(f));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={backHref} className="text-sm text-neutral-500 hover:text-neutral-800">
            ← Back
          </Link>
          <h1 className="text-xl font-bold tracking-tight text-neutral-900">
            {claim.claimNo} <span className="font-normal text-neutral-500">· WO {claim.workOrder}</span>
          </h1>
        </div>
        <StatusPill status={claim.status} />
      </div>

      {claim.reviewComment && (claim.status === "returned" || claim.status === "rejected" || claim.status === "approved") && (
        <div className={`rounded-xl p-4 text-sm ${claim.status === "rejected" ? "bg-red-50 text-red-800" : claim.status === "returned" ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"}`}>
          <div className="font-semibold">
            {claim.status === "returned" ? "To correct" : claim.status === "rejected" ? "Rejection reason" : "Comment"} - {claim.reviewedBy}, {fmtDateTime(claim.reviewedAt)}
          </div>
          <p className="mt-1 whitespace-pre-wrap">{claim.reviewComment}</p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3 rounded-xl bg-white p-4 text-sm shadow-sm ring-1 ring-neutral-200/70 sm:grid-cols-3">
        <div className="col-span-2 sm:col-span-1">
          <dt className="text-xs text-neutral-500">VIN</dt>
          <dd className="font-mono font-medium select-all">{claim.vin}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Work order</dt>
          <dd className="font-medium select-all">{claim.workOrder}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">End of repair</dt>
          <dd className="font-medium">{fmtDateTime(claim.endOfRepair)}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Technician</dt>
          <dd className="font-medium">{claim.technician}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Branch</dt>
          <dd className="font-medium">{claim.branch}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Sent</dt>
          <dd className="font-medium">{fmtDateTime(claim.submittedAt)}</dd>
        </div>
        {claim.notes && (
          <div className="col-span-2 sm:col-span-3">
            <dt className="text-xs text-neutral-500">Notes</dt>
            <dd className="whitespace-pre-wrap">{claim.notes}</dd>
          </div>
        )}
      </dl>

      {canReview && <ReviewPanel claimId={claim.id} />}

      {canEdit ? (
        <TechClaimForm
          who={claim.technician}
          claimId={claim.id}
          initial={{ vin: claim.vin, workOrder: claim.workOrder, endOfRepair: claim.endOfRepair, notes: claim.notes }}
          existing={claim.fileList.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size }))}
        />
      ) : (
        <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-neutral-900">Files ({claim.fileList.length})</h2>
            {showDrive && claim.driveFolderId && (
              <a href={`https://drive.google.com/drive/folders/${claim.driveFolderId}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand hover:underline">
                Open folder in Google Drive
              </a>
            )}
          </div>
          {media.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {media.map((f) =>
                f.mimeType.startsWith("video/") ? (
                  <div key={f.id} className="space-y-1">
                    <video src={fileUrl(f.id)} controls preload="metadata" playsInline className="aspect-video w-full rounded-lg bg-black" />
                    <div className="truncate text-xs text-neutral-500">{f.name} · {fmtBytes(f.size)}</div>
                  </div>
                ) : (
                  <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="space-y-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`${fileUrl(f.id)}?thumb=1`} alt={f.name} loading="lazy" className="aspect-video w-full rounded-lg bg-neutral-100 object-cover" />
                    <div className="truncate text-xs text-neutral-500">{f.name}</div>
                  </a>
                )
              )}
            </div>
          )}
          {docs.length > 0 && (
            <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-100 text-sm">
              {docs.map((f) => (
                <li key={f.id} className="flex items-center gap-2 px-3 py-2">
                  <span>📄</span>
                  <a href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-brand hover:underline">
                    {f.name}
                  </a>
                  <span className="text-xs text-neutral-500">{fmtBytes(f.size)}</span>
                </li>
              ))}
            </ul>
          )}
          {claim.fileList.length === 0 && <p className="text-sm text-neutral-500">No files.</p>}
        </section>
      )}

      <section className="space-y-2 rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
        <h2 className="font-semibold text-neutral-900">History</h2>
        <ol className="space-y-2 text-sm">
          <li className="flex gap-2">
            <span className="text-neutral-400">•</span>
            <span>
              Started by {claim.technician} · <span className="text-neutral-500">{fmtDateTime(claim.createdAt)}</span>
            </span>
          </li>
          {claim.events.map((e) => (
            <li key={e.id} className="flex gap-2">
              <span className="text-neutral-400">•</span>
              <span>
                <span className="font-medium">{EVENT_LABEL[e.kind] ?? e.kind}</span> by {e.author ?? "—"} · <span className="text-neutral-500">{fmtDateTime(e.at)}</span>
                {e.body && <span className="block whitespace-pre-wrap text-neutral-600">{e.body}</span>}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
