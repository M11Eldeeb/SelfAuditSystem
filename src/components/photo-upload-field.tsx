"use client";

import { useEffect, useRef, useState } from "react";
import { prepareSelfAuditDocUpload, type DocTarget } from "@/app/actions/self-audit-docs";
import { uploadToSession } from "@/components/tech-claims/upload";
import { MAX_MULTI_FILES } from "@/lib/photo-types";
import type { PhotoStatus } from "@/lib/photo-status";

type Shown = { key: string; label: string; url: string; kind: "image" | "pdf" | "other" };

type Pending = {
  key: string;
  name: string;
  size: number;
  type: string;
  blob: string;
  phase: "uploading" | "done" | "error";
  pct: number;
  path?: string;
  error?: string;
};

const kindOf = (nameOrType: string): Shown["kind"] => {
  const s = nameOrType.toLowerCase();
  if (s === "application/pdf" || s.endsWith(".pdf")) return "pdf";
  if (s.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic|heif)$/.test(s)) return "image";
  return "other";
};

/** A small picture (or a PDF tile) of a file; a click opens it large. */
function Thumb({ item, onOpen }: { item: Shown; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${item.label} - click to preview`}
      className="group relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 shadow-sm hover:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      {item.kind === "image" && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.url} alt={item.label} className="h-full w-full object-cover" onError={() => setBroken(true)} draggable={false} />
      ) : (
        <span className="text-xs font-semibold text-neutral-500">{item.kind === "pdf" ? "PDF" : "File"}</span>
      )}
      <span className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-center text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Preview</span>
    </button>
  );
}

/** The full-size preview of one file (a photo, or a PDF in a frame), with a link to open it in its own tab. */
function Lightbox({ item, onClose }: { item: Shown; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={item.label}>
      <div className="flex max-h-full w-full max-w-4xl flex-col gap-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-medium text-white">{item.label}</span>
          <span className="flex shrink-0 items-center gap-2">
            <a href={item.url} target="_blank" rel="noreferrer" className="rounded-md bg-white/10 px-2.5 py-1 text-xs text-white hover:bg-white/20">
              Open in new tab
            </a>
            <button type="button" onClick={onClose} className="rounded-md bg-white/10 px-2.5 py-1 text-xs text-white hover:bg-white/20">
              Close
            </button>
          </span>
        </div>
        {item.kind === "pdf" ? (
          <iframe src={item.url} title={item.label} className="h-[80vh] w-full rounded-md bg-white" />
        ) : item.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.url} alt={item.label} className="max-h-[80vh] w-full rounded-md object-contain" />
        ) : (
          <p className="rounded-md bg-white p-6 text-center text-sm text-neutral-700">This file cannot be previewed here - use the Open in new tab button.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Uploads directly from the browser to Google Drive (Self Audit Documents / month / branch / claim): the server only
 * opens the upload session; the bytes go browser -> Google. Only the resulting "drive:<id>.<ext>" goes through the
 * form submission. Every file picked (and every file already saved) shows as a small preview that opens large on a
 * click. With `multiple` the field takes several files (one hidden input per uploaded file, same field name).
 */
export function PhotoUploadField({
  label,
  helpText,
  required,
  locked,
  target,
  photoTypeId,
  status,
  statuses,
  fieldName,
  multiple = false,
}: {
  label: string;
  helpText: string | null;
  required: boolean;
  locked: boolean;
  target: DocTarget;
  photoTypeId: string;
  /** The one saved file of a single-file type. */
  status?: PhotoStatus | undefined;
  /** The saved files of a multi-file type. */
  statuses?: PhotoStatus[];
  fieldName: string;
  multiple?: boolean;
}) {
  const [items, setItems] = useState<Pending[]>([]);
  const [preview, setPreview] = useState<Shown | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const seq = useRef(0);
  const blobs = useRef(new Set<string>());

  useEffect(() => {
    const all = blobs.current;
    return () => all.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const saved = statuses ?? (status ? [status] : []);
  const savedShown: Shown[] = [];
  let removed = 0;
  saved.forEach((s, i) => {
    if ("url" in s) savedShown.push({ key: `s${i}`, label: multiple ? `${label} ${i + 1}` : label, url: s.url, kind: kindOf(s.path) });
    else removed++;
  });

  // After a save the page brings the saved files (including the ones just uploaded): the "uploaded, not saved yet" tiles go.
  const sig = saved.map((s) => ("path" in s ? s.path : "removed")).join("|");
  const lastSig = useRef(sig);
  useEffect(() => {
    if (lastSig.current === sig) return;
    lastSig.current = sig;
    setItems((cur) => {
      cur.filter((i) => i.phase === "done").forEach((i) => {
        URL.revokeObjectURL(i.blob);
        blobs.current.delete(i.blob);
      });
      return cur.filter((i) => i.phase !== "done");
    });
  }, [sig]);

  const patch = (key: string, p: Partial<Pending>) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...p } : i)));

  async function sendOne(file: File, key: string, number: number) {
    const prep = await prepareSelfAuditDocUpload(target, photoTypeId, { name: file.name, type: file.type, size: file.size }, multiple ? number : undefined);
    if (prep.error || !prep.session) return patch(key, { phase: "error", error: prep.error ?? "Could not start the upload." });
    try {
      const id = await uploadToSession(prep.session, file, (sent) => patch(key, { pct: Math.round((sent / Math.max(1, file.size)) * 100) }));
      const ext = (file.name.split(".").pop() || (file.type === "application/pdf" ? "pdf" : "jpg")).toLowerCase();
      patch(key, { phase: "done", pct: 100, path: `drive:${id}.${ext}` });
    } catch (err) {
      patch(key, { phase: "error", error: err instanceof Error ? err.message : "The upload failed." });
    }
  }

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!picked.length) return;
    setNotice(null);
    let files = multiple ? picked : picked.slice(0, 1);
    if (multiple) {
      const room = Math.max(0, MAX_MULTI_FILES - savedShown.length - items.filter((i) => i.phase !== "error").length);
      if (files.length > room) setNotice(`Up to ${MAX_MULTI_FILES} files here - ${room ? `the first ${room} were added` : "no more can be added"}.`);
      files = files.slice(0, room);
    }
    if (!files.length) return;
    const already = saved.length + items.length;
    const fresh = files.map((f, n) => {
      const blob = URL.createObjectURL(f);
      blobs.current.add(blob);
      return { file: f, number: already + n + 1, item: { key: `p${++seq.current}`, name: f.name, size: f.size, type: f.type, blob, phase: "uploading", pct: 0 } as Pending };
    });
    if (multiple) setItems((cur) => [...cur, ...fresh.map((x) => x.item)]);
    else {
      items.forEach((i) => URL.revokeObjectURL(i.blob));
      setItems(fresh.map((x) => x.item));
    }
    // a few at a time
    const queue = [...fresh];
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (let x = queue.shift(); x; x = queue.shift()) await sendOne(x.file, x.item.key, x.number);
    }));
  }

  function drop(key: string) {
    setItems((cur) => {
      const gone = cur.find((i) => i.key === key);
      if (gone) {
        URL.revokeObjectURL(gone.blob);
        blobs.current.delete(gone.blob);
      }
      return cur.filter((i) => i.key !== key);
    });
  }

  const busy = items.some((i) => i.phase === "uploading");
  const shownCount = savedShown.length + items.length;

  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-neutral-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
        {multiple && <span className="ml-1 text-xs font-normal text-neutral-400">(several files allowed)</span>}
      </label>
      {helpText && <p className="text-xs text-neutral-500">{helpText}</p>}

      {removed > 0 && <p className="text-xs text-neutral-400">Photo removed after review to save storage.</p>}

      {shownCount > 0 && (
        <ul className="flex flex-wrap gap-2 pt-1">
          {savedShown.map((s) => (
            <li key={s.key} className="space-y-0.5">
              <Thumb item={s} onOpen={() => setPreview(s)} />
              <span className="block w-20 truncate text-center text-[10px] text-neutral-400">Saved</span>
            </li>
          ))}
          {items.map((it) => {
            const shown: Shown = { key: it.key, label: it.name, url: it.blob, kind: kindOf(it.type || it.name) };
            return (
              <li key={it.key} className="space-y-0.5">
                <div className="relative">
                  <Thumb item={shown} onOpen={() => setPreview(shown)} />
                  {!locked && it.phase !== "uploading" && (
                    <button
                      type="button"
                      onClick={() => drop(it.key)}
                      aria-label={`Remove ${it.name}`}
                      title="Remove"
                      className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-800 text-xs leading-none text-white shadow hover:bg-red-600"
                    >
                      ×
                    </button>
                  )}
                </div>
                <span className={`block w-20 truncate text-center text-[10px] ${it.phase === "error" ? "text-red-600" : it.phase === "done" ? "text-green-600" : "text-neutral-500"}`} title={it.error ?? it.name}>
                  {it.phase === "uploading" ? `Uploading ${it.pct}%` : it.phase === "done" ? "Uploaded" : "Failed"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {items.filter((i) => i.phase === "error").map((i) => (
        <p key={i.key} className="text-xs text-red-600">
          Upload failed ({i.name}): {i.error}
        </p>
      ))}
      {!multiple && items[0]?.phase === "done" && savedShown.length > 0 && <p className="text-xs text-neutral-500">The new file replaces the saved one once you save.</p>}

      {!locked && (
        <>
          <input
            type="file"
            multiple={multiple}
            accept="image/*,application/pdf"
            disabled={busy}
            onChange={handleChange}
            className="block w-full text-sm text-neutral-700 file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-neutral-700 file:shadow-sm hover:file:bg-neutral-50"
          />
          {notice && <p className="text-xs text-amber-700">{notice}</p>}
          {items.filter((i) => i.phase === "done" && i.path).map((i) => (
            <input key={i.key} type="hidden" name={fieldName} value={i.path} />
          ))}
        </>
      )}

      {preview && <Lightbox item={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
