"use client";

import { useState } from "react";

export type AuditDoc = { id: string; label: string; status: "ok" | "removed" | "missing"; url?: string; kind?: "image" | "pdf" | "other" };

const LENS = 170;
const ZOOM = 2.6;

/** An image with a round magnifying lens that follows the cursor. A click opens it full size. */
function Magnifier({ src, alt, onOpen }: { src: string; alt: string; onOpen: () => void }) {
  const [lens, setLens] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setLens({ x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height });
      }}
      onMouseLeave={() => setLens(null)}
      className="relative block w-full cursor-zoom-in overflow-visible rounded-lg border border-neutral-200 bg-neutral-50"
      title={`${alt} - click to open full size`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="block w-full rounded-lg object-contain" draggable={false} />
      {lens && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute z-20 rounded-full border-2 border-white shadow-[0_8px_30px_rgba(0,0,0,0.35)] ring-1 ring-black/20"
          style={{
            width: LENS,
            height: LENS,
            left: lens.x - LENS / 2,
            top: lens.y - LENS / 2,
            backgroundImage: `url("${src}")`,
            backgroundRepeat: "no-repeat",
            backgroundColor: "#fff",
            backgroundSize: `${lens.w * ZOOM}px ${lens.h * ZOOM}px`,
            backgroundPosition: `${-(lens.x * ZOOM - LENS / 2)}px ${-(lens.y * ZOOM - LENS / 2)}px`,
          }}
        />
      )}
    </button>
  );
}

/**
 * The claim's documents in their order (Job Card front, back, Repair Agreement, Parts Requisition, QC Report, Supporting
 * Documents) as small previews down the side of the review - hover to magnify, click to open full size.
 */
export function AuditDocumentsPanel({ docs }: { docs: AuditDoc[] }) {
  const [full, setFull] = useState<AuditDoc | null>(null);
  return (
    <aside className="space-y-4">
      <h2 className="text-sm font-semibold text-neutral-900">Documents</h2>
      {docs.map((d) => (
        <figure key={d.id} className="space-y-1.5">
          <figcaption className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-neutral-800">{d.label}</span>
            {d.status === "ok" && d.url && (
              <a href={d.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                Open
              </a>
            )}
          </figcaption>
          {d.status === "ok" && d.url ? (
            d.kind === "image" ? (
              <Magnifier src={d.url} alt={d.label} onOpen={() => setFull(d)} />
            ) : d.kind === "pdf" ? (
              <iframe src={d.url} title={d.label} className="h-72 w-full rounded-lg border border-neutral-200 bg-white" />
            ) : (
              <a href={d.url} target="_blank" rel="noreferrer" className="block rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 hover:bg-blue-100">
                Open file
              </a>
            )
          ) : (
            <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-3 py-4 text-center text-xs text-neutral-400">
              {d.status === "removed" ? "Removed after review" : "Not uploaded"}
            </div>
          )}
        </figure>
      ))}

      {full?.url && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={() => setFull(null)} role="dialog" aria-modal="true" aria-label={full.label}>
          <div className="flex max-h-full max-w-full flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex w-full items-center justify-between gap-4">
              <span className="text-sm font-medium text-white">{full.label}</span>
              <button type="button" onClick={() => setFull(null)} className="rounded-md bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20">
                Close
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={full.url} alt={full.label} className="max-h-[85vh] max-w-full rounded-md object-contain" />
          </div>
        </div>
      )}
    </aside>
  );
}
