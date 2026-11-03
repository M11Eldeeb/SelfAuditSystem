"use client";

import { useCallback, useEffect, useState } from "react";
import { Glyph } from "@/components/ui/glyph";
import { fmtBytes } from "./upload";

type GalleryFile = { id: string; name: string; mimeType: string; size: number };

const fileUrl = (id: string, download = false) => `/api/tech-claims/file/${id}${download ? "?download=1" : ""}`;
const kindOf = (mime: string) => (mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime === "application/pdf" ? "pdf" : "none");

/** Full-screen preview of one file (as in Warranty and Technical Documents), with previous / next through the claim's files. */
function Preview({ files, index, onIndex, onClose }: { files: GalleryFile[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const f = files[index];
  const k = kindOf(f.mimeType);
  const prev = useCallback(() => onIndex((index - 1 + files.length) % files.length), [index, files.length, onIndex]);
  const next = useCallback(() => onIndex((index + 1) % files.length), [index, files.length, onIndex]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, next, prev]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label={f.name}>
      <div className="flex h-full max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate font-semibold text-neutral-900" title={f.name}>
              <Glyph name={k === "image" ? "image" : k === "video" ? "video" : k === "pdf" ? "pdf" : "file"} className="mr-1.5 text-neutral-500" />
              {f.name}
            </div>
            <div className="text-xs text-neutral-500">
              {index + 1} of {files.length} · {fmtBytes(f.size)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {files.length > 1 && (
              <>
                <button type="button" onClick={prev} aria-label="Previous file" className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
                  ‹ Previous
                </button>
                <button type="button" onClick={next} aria-label="Next file" className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
                  Next ›
                </button>
              </>
            )}
            <a href={fileUrl(f.id, true)} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark">
              <Glyph name="download" className="mr-1.5" />
              Download
            </a>
            <button type="button" onClick={onClose} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white">
              Close
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 bg-neutral-100">
          {k === "pdf" && <iframe key={f.id} src={fileUrl(f.id)} title={f.name} className="h-full w-full" />}
          {k === "image" && (
            <div className="flex h-full items-center justify-center p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img key={f.id} src={fileUrl(f.id)} alt={f.name} className="max-h-full max-w-full object-contain" />
            </div>
          )}
          {k === "video" && <video key={f.id} src={fileUrl(f.id)} controls preload="metadata" playsInline className="h-full w-full bg-black" />}
          {k === "none" && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-neutral-600">
              This file type cannot be shown in the browser.
              <a href={fileUrl(f.id, true)} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
                Download {f.name}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The claim's files: photo / video tiles and a PDF list - a click opens the preview. */
export function TechClaimFileGallery({ files }: { files: GalleryFile[] }) {
  const media = files.filter((f) => f.mimeType.startsWith("image/") || f.mimeType.startsWith("video/"));
  const docs = files.filter((f) => !media.includes(f));
  const ordered = [...media, ...docs];
  const [open, setOpen] = useState<number | null>(null);
  const show = (f: GalleryFile) => setOpen(ordered.indexOf(f));

  return (
    <>
      {media.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {media.map((f) => (
            <button key={f.id} type="button" onClick={() => show(f)} className="group space-y-1 text-left">
              <div className="relative overflow-hidden rounded-lg bg-neutral-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${fileUrl(f.id)}?thumb=1`} alt={f.name} loading="lazy" className="aspect-video w-full object-cover transition group-hover:scale-[1.02]" />
                {f.mimeType.startsWith("video/") && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white">
                      <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path d="M6 4l10 6-10 6z" />
                      </svg>
                    </span>
                  </span>
                )}
              </div>
              <div className="truncate text-xs text-neutral-500">
                {f.name} · {fmtBytes(f.size)}
              </div>
            </button>
          ))}
        </div>
      )}
      {docs.length > 0 && (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-100 text-sm">
          {docs.map((f) => (
            <li key={f.id}>
              <button type="button" onClick={() => show(f)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-neutral-50">
                <Glyph name="pdf" className="text-neutral-500" />
                <span className="min-w-0 flex-1 truncate hover:text-brand">{f.name}</span>
                <span className="text-xs text-neutral-500">{fmtBytes(f.size)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open != null && ordered[open] && <Preview files={ordered} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </>
  );
}
