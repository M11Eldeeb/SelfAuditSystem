import Link from "next/link";
import type { TechClaimDetail } from "@/lib/tech-claims/server";
import { StatusPill, fmtDateTime } from "./status";
import { fmtBytes } from "./upload";
import { ReviewPanel } from "./review-panel";
import { TechClaimForm } from "./claim-form";
import { DownloadAllButton } from "./download-all";
import { Glyph } from "@/components/ui/glyph";
import { techT, type Lang } from "@/lib/i18n/tech";

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
  lang,
  branchCode,
}: {
  claim: TechClaimDetail;
  backHref: string;
  canReview: boolean;
  canEdit: boolean;
  showDrive: boolean;
  /** The technician's view (his language); admin pages leave it out. */
  lang?: Lang;
  /** The technician's branch code, put in front of the work order number he types. */
  branchCode?: string;
}) {
  const t = techT(lang ?? "en");
  const fileUrl = (id: string) => `/api/tech-claims/file/${id}`;
  const media = claim.fileList.filter((f) => f.mimeType.startsWith("image/") || f.mimeType.startsWith("video/"));
  const docs = claim.fileList.filter((f) => !media.includes(f));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={backHref} className="text-sm text-neutral-500 hover:text-neutral-800">
            {lang === "ar" ? "→" : "←"} {t.back}
          </Link>
          <h1 className="text-xl font-bold tracking-tight text-neutral-900">
            {claim.claimNo} <span className="font-normal text-neutral-500">· {lang ? t.workOrder : "WO"} {claim.workOrder}</span>
          </h1>
        </div>
        <StatusPill status={claim.status} lang={lang} />
      </div>

      {claim.reviewComment && (claim.status === "returned" || claim.status === "rejected" || claim.status === "approved") && (
        <div className={`rounded-xl p-4 text-sm ${claim.status === "rejected" ? "bg-red-50 text-red-800" : claim.status === "returned" ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"}`}>
          <div className="font-semibold">
            {claim.status === "returned" ? t.toCorrectTitle : claim.status === "rejected" ? t.rejectionReason : t.comment} - {claim.reviewedBy}, {fmtDateTime(claim.reviewedAt)}
          </div>
          <p className="mt-1 whitespace-pre-wrap">{claim.reviewComment}</p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3 rounded-xl bg-white p-4 text-sm shadow-sm ring-1 ring-neutral-200/70 sm:grid-cols-3">
        {!lang && (
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-xs text-neutral-500">{t.vin}</dt>
            <dd className="font-mono font-medium select-all" dir="ltr">{claim.vin || "—"}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-neutral-500">{t.workOrder}</dt>
          <dd className="font-medium select-all">{claim.workOrder}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">{t.endOfRepair}</dt>
          <dd className="font-medium" dir="ltr">{fmtDateTime(claim.endOfRepair)}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">{t.technician}</dt>
          <dd className="font-medium">{claim.technician}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">{t.branch}</dt>
          <dd className="font-medium">{claim.branch}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">{t.sent}</dt>
          <dd className="font-medium" dir="ltr">{fmtDateTime(claim.submittedAt)}</dd>
        </div>
        {claim.notes && (
          <div className="col-span-2 sm:col-span-3">
            <dt className="text-xs text-neutral-500">{t.notes}</dt>
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
          lang={lang ?? "en"}
          branchCode={branchCode}
        />
      ) : (
        <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-neutral-900">{t.files(claim.fileList.length)}</h2>
            {showDrive && (
              <span className="flex flex-wrap items-center gap-3">
                {claim.driveFolderId && (
                  <a href={`https://drive.google.com/drive/folders/${claim.driveFolderId}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand hover:underline">
                    Open in Google Drive
                  </a>
                )}
                <DownloadAllButton files={claim.fileList.map((f) => ({ id: f.id, name: f.name }))} zipName={`${claim.claimNo} - WO ${claim.workOrder} - ${claim.technician}`} />
              </span>
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
                  <Glyph name="pdf" className="text-neutral-500" />
                  <a href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-brand hover:underline">
                    {f.name}
                  </a>
                  <span className="text-xs text-neutral-500">{fmtBytes(f.size)}</span>
                </li>
              ))}
            </ul>
          )}
          {claim.fileList.length === 0 && <p className="text-sm text-neutral-500">{t.noFiles}</p>}
        </section>
      )}

      <section className="space-y-2 rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
        <h2 className="font-semibold text-neutral-900">{t.history}</h2>
        <ol className="space-y-2 text-sm">
          <li className="flex gap-2">
            <span className="text-neutral-400">•</span>
            <span>
              {t.startedBy(claim.technician)} · <span className="text-neutral-500" dir="ltr">{fmtDateTime(claim.createdAt)}</span>
            </span>
          </li>
          {claim.events.map((e) => (
            <li key={e.id} className="flex gap-2">
              <span className="text-neutral-400">•</span>
              <span>
                <span className="font-medium">{t.events[e.kind] ?? e.kind}</span> {t.by} {e.author ?? "—"} · <span className="text-neutral-500" dir="ltr">{fmtDateTime(e.at)}</span>
                {e.body && <span className="block whitespace-pre-wrap text-neutral-600">{e.body}</span>}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
