"use client";

import { useState } from "react";
import type { PhotoStatus } from "@/lib/photo-status";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp"]);

function isImagePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
}

export function PhotoLinks({
  photoTypes,
  statusByType,
}: {
  photoTypes: { id: string; label: string }[];
  statusByType: Map<string, PhotoStatus>;
}) {
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);

  return (
    <div className="flex flex-wrap gap-3">
      {photoTypes.map((pt) => {
        const status = statusByType.get(pt.id);

        if (status && "url" in status) {
          if (isImagePath(status.path)) {
            return (
              <div key={pt.id} className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPreview({ url: status.url, label: pt.label })}
                  className="block overflow-hidden rounded-md border border-neutral-200 transition hover:border-brand"
                  title={`Preview ${pt.label}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={status.url} alt={pt.label} className="h-20 w-20 object-cover" />
                </button>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-neutral-600">{pt.label}</span>
                  <a href={status.url} target="_blank" rel="noreferrer" className="text-brand underline">
                    Open
                  </a>
                </div>
              </div>
            );
          }

          return (
            <a
              key={pt.id}
              href={status.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-100"
            >
              {pt.label}
            </a>
          );
        }

        if (status && "removed" in status) {
          return (
            <span
              key={pt.id}
              className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-400"
              title="Deleted from storage after the officer's review to save space"
            >
              {pt.label} (removed after review)
            </span>
          );
        }

        return (
          <span
            key={pt.id}
            className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-400"
          >
            {pt.label} (not uploaded)
          </span>
        );
      })}

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setPreview(null)}
        >
          <div className="flex max-h-full max-w-full flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex w-full items-center justify-between gap-4">
              <span className="text-sm font-medium text-white">{preview.label}</span>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="rounded-md bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20"
              >
                Close
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.url}
              alt={preview.label}
              className="max-h-[80vh] max-w-full rounded-md object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
