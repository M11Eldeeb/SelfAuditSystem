"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createDocumentFolder, prepareDocumentUploads, registerDocumentUploads, syncDocuments } from "@/app/actions/documents";
import { Glyph, type GlyphName } from "@/components/ui/glyph";

export type DocItem = { id: string; lib: "warranty" | "technical"; parent: string | null; name: string; mime: string; folder: boolean; size: number | null; modified: string | null };
type Lib = { key: "warranty" | "technical"; label: string; rootId: string };

const STALE_MS = 6 * 3600_000;
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Riyadh" }) : "");
const fmtStamp = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Riyadh" }) : "never");
const fmtSize = (b: number | null) => (b == null ? "" : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function kind(mime: string, name: string): { icon: GlyphName; label: string; preview: "pdf" | "image" | "video" | "audio" | "none" } {
  if (mime === "application/vnd.google-apps.folder") return { icon: "folder", label: "Folder", preview: "none" };
  if (mime === "application/pdf") return { icon: "pdf", label: "PDF", preview: "pdf" };
  if (mime === "application/vnd.google-apps.document") return { icon: "file", label: "Google Doc", preview: "pdf" };
  if (mime === "application/vnd.google-apps.spreadsheet") return { icon: "sheet", label: "Google Sheet", preview: "pdf" };
  if (mime === "application/vnd.google-apps.presentation") return { icon: "slides", label: "Google Slides", preview: "pdf" };
  if (/^image\/(png|jpe?g|gif|webp|bmp)/.test(mime)) return { icon: "image", label: "Image", preview: "image" };
  if (mime.startsWith("video/")) return { icon: "video", label: "Video", preview: "video" };
  if (mime.startsWith("audio/")) return { icon: "audio", label: "Audio", preview: "audio" };
  if (/sheet|excel|csv/i.test(mime) || /\.(xlsx?|csv)$/i.test(name)) return { icon: "sheet", label: "Excel", preview: "none" };
  if (/word|document/i.test(mime) || /\.docx?$/i.test(name)) return { icon: "file", label: "Word", preview: "none" };
  if (/presentation|powerpoint/i.test(mime) || /\.pptx?$/i.test(name)) return { icon: "slides", label: "PowerPoint", preview: "none" };
  if (/zip|rar|7z/i.test(mime)) return { icon: "archive", label: "Archive", preview: "none" };
  return { icon: "file", label: "File", preview: "none" };
}

const fileUrl = (id: string, download = false) => `/api/documents/file/${id}${download ? "?download=1" : ""}`;

function Preview({ item, onClose, canManage }: { item: DocItem; onClose: () => void; canManage: boolean }) {
  const k = kind(item.mime, item.name);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label={item.name}>
      <div className="flex h-full max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate font-semibold text-neutral-900" title={item.name}>
              <Glyph name={k.icon} className="mr-1.5 text-neutral-500" />
              {item.name}
            </div>
            <div className="text-xs text-neutral-500">
              {k.label} {item.size != null && `· ${fmtSize(item.size)}`} {item.modified && `· updated ${fmtDate(item.modified)}`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href={fileUrl(item.id, true)} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark">
              <Glyph name="download" className="mr-1.5" />
              Download
            </a>
            {canManage && (
              <a href={`https://drive.google.com/file/d/${item.id}/view`} target="_blank" rel="noreferrer" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
                Open in Drive
              </a>
            )}
            <button type="button" onClick={onClose} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white">
              Close
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 bg-neutral-100">
          {k.preview === "pdf" && <iframe src={fileUrl(item.id)} title={item.name} className="h-full w-full" />}
          {k.preview === "image" && (
            <div className="flex h-full items-center justify-center p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(item.id)} alt={item.name} className="max-h-full max-w-full object-contain" />
            </div>
          )}
          {k.preview === "video" && <video src={fileUrl(item.id)} controls className="h-full w-full bg-black" />}
          {k.preview === "audio" && (
            <div className="flex h-full items-center justify-center">
              <audio src={fileUrl(item.id)} controls />
            </div>
          )}
          {k.preview === "none" && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-neutral-600">
              <Glyph name={k.icon} size={44} className="text-neutral-400" />
              This file type cannot be shown in the browser.
              <a href={fileUrl(item.id, true)} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
                <Glyph name="download" className="mr-1.5" />
                Download {item.name}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Warranty and Technical Documents: the two Google Drive folders, browsable and searchable in the portal. Files open
 * inside the portal (PDF, images, video; Google Docs as PDF) or download. Officers also upload, add folders and
 * re-read Drive; the files always live in Google Drive.
 */
export function DocumentsBrowser({
  items,
  libraries,
  canManage,
  connectedAs,
  lastSync,
  syncError,
  flag,
}: {
  items: DocItem[];
  libraries: Lib[];
  canManage: boolean;
  connectedAs: string | null;
  lastSync: string | null;
  syncError: string | null;
  flag?: string;
}) {
  const router = useRouter();
  const [libKey, setLibKey] = useState<Lib["key"]>("warranty");
  const lib = libraries.find((l) => l.key === libKey)!;
  const [folderId, setFolderId] = useState(lib.rootId);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"name" | "modified">("name");
  const [preview, setPreview] = useState<DocItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(
    flag === "connected" ? { ok: true, text: "Google Drive connected - reading the folders..." } : flag ? { ok: false, text: "Connecting Google Drive did not finish - please try again." } : null
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const autoSynced = useRef(false);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const libItems = useMemo(() => items.filter((i) => i.lib === libKey), [items, libKey]);
  const counts = useMemo(() => Object.fromEntries(libraries.map((l) => [l.key, items.filter((i) => i.lib === l.key && !i.folder).length])), [items, libraries]);

  async function sync(manual: boolean) {
    setBusy("Reading Google Drive...");
    const r = await syncDocuments();
    setBusy(null);
    if (r.error) setMsg({ ok: false, text: r.error });
    else if (!r.skipped) {
      if (manual || flag === "connected") setMsg({ ok: true, text: `Up to date - ${r.files} files and folders.` });
      router.refresh();
    }
  }

  // Keep the index fresh on its own: re-read Drive when it is older than six hours (or right after connecting).
  useEffect(() => {
    if (autoSynced.current || !connectedAs) return;
    if (flag === "connected" || !lastSync || Date.now() - Date.parse(lastSync) > STALE_MS) {
      autoSynced.current = true;
      queueMicrotask(() => void sync(false));
    }
  });

  const crumbs = useMemo(() => {
    const out: { id: string; name: string }[] = [];
    let cur = byId.get(folderId);
    while (cur) {
      out.unshift({ id: cur.id, name: cur.name });
      cur = cur.parent ? byId.get(cur.parent) : undefined;
    }
    return [{ id: lib.rootId, name: lib.label }, ...out];
  }, [byId, folderId, lib]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const list = q ? libItems.filter((i) => i.name.toLowerCase().includes(q)) : libItems.filter((i) => i.parent === folderId);
    return [...list].sort((a, b) => (a.folder !== b.folder ? (a.folder ? -1 : 1) : sort === "name" ? a.name.localeCompare(b.name) : (b.modified ?? "").localeCompare(a.modified ?? "")));
  }, [libItems, folderId, q, sort]);
  const recent = useMemo(() => libItems.filter((i) => !i.folder && i.modified).sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? "")).slice(0, 6), [libItems]);
  const pathOf = (i: DocItem) => {
    const parts: string[] = [];
    let cur = i.parent ? byId.get(i.parent) : undefined;
    while (cur) {
      parts.unshift(cur.name);
      cur = cur.parent ? byId.get(cur.parent) : undefined;
    }
    return parts.join(" / ") || lib.label;
  };
  const countIn = (id: string) => libItems.filter((i) => i.parent === id).length;

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    setMsg(null);
    setBusy("Preparing the upload...");
    const prep = await prepareDocumentUploads(folderId, list.map((f) => ({ name: f.name, type: f.type || "application/octet-stream", size: f.size })));
    if (prep.error || !prep.sessions) {
      setBusy(null);
      setMsg({ ok: false, text: prep.error ?? "Upload failed." });
      return;
    }
    const done: { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string }[] = [];
    for (let i = 0; i < list.length; i++) {
      setBusy(`Uploading ${i + 1} of ${list.length}: ${list[i].name}`);
      const res = await fetch(prep.sessions[i], { method: "PUT", headers: { "Content-Type": list[i].type || "application/octet-stream" }, body: list[i] });
      const json = (await res.json().catch(() => null)) as { id?: string; name?: string; mimeType?: string; size?: string; modifiedTime?: string } | null;
      if (!res.ok || !json?.id) {
        setBusy(null);
        setMsg({ ok: false, text: `Google Drive did not accept "${list[i].name}".` });
        break;
      }
      done.push({ id: json.id, name: json.name ?? list[i].name, mimeType: json.mimeType ?? list[i].type, size: json.size, modifiedTime: json.modifiedTime });
    }
    if (done.length) {
      await registerDocumentUploads(folderId, done);
      setMsg({ ok: true, text: `${done.length} file(s) saved to Google Drive.` });
      router.refresh();
    }
    setBusy(null);
  }

  async function newFolder() {
    const name = window.prompt("New folder name");
    if (!name?.trim()) return;
    setBusy("Creating the folder...");
    const r = await createDocumentFolder(folderId, name);
    setBusy(null);
    if (r.error) setMsg({ ok: false, text: r.error });
    else router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Warranty and Technical Documents</h1>
          <p className="text-sm text-neutral-500">Kept in Google Drive - open, search and download them here. Last read from Drive {fmtStamp(lastSync)}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {connectedAs && (
            <button type="button" onClick={() => void sync(true)} disabled={!!busy} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50 disabled:opacity-50">
              ↻ Refresh from Drive
            </button>
          )}
          {canManage && (
            <a href="/api/google-mail/connect?purpose=docs" className={`rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm ${connectedAs ? "text-neutral-500 underline" : "bg-brand text-white hover:bg-brand-dark"}`}>
              {connectedAs ? `Drive: ${connectedAs} · change` : "Connect Google Drive"}
            </a>
          )}
        </div>
      </div>

      {!connectedAs && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {canManage
            ? "Connect the Google account that owns (or can open) the two document folders - the portal reads them and saves uploads there."
            : "The documents are not connected yet - please ask the warranty officer."}
        </p>
      )}
      {syncError && canManage && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Last read from Drive failed: {syncError}</p>}
      {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}
      {busy && <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">{busy}</p>}

      <div className="flex gap-1 rounded-xl bg-neutral-100 p-1 text-sm font-semibold">
        {libraries.map((l) => (
          <button
            key={l.key}
            type="button"
            onClick={() => {
              setLibKey(l.key);
              setFolderId(l.rootId);
              setQuery("");
            }}
            className={`flex-1 rounded-lg px-3 py-2 ${libKey === l.key ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}
          >
            <Glyph name={l.key === "warranty" ? "shield" : "wrench"} className="mr-1.5 text-brand" />
            {l.label} <span className="ml-1 text-xs font-normal text-neutral-400">{counts[l.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search all ${lib.label.toLowerCase()}...`}
          className="h-10 min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 text-sm shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as "name" | "modified")} className="h-10 rounded-lg border border-neutral-300 bg-white px-2 text-sm">
          <option value="name">Sort: name</option>
          <option value="modified">Sort: newest</option>
        </select>
        {canManage && connectedAs && !q && (
          <>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => void upload(e.target.files).finally(() => (e.target.value = ""))} />
            <button type="button" disabled={!!busy} onClick={() => fileInput.current?.click()} className="h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50">
              <Glyph name="upload" className="mr-1.5" />
              Upload here
            </button>
            <button type="button" disabled={!!busy} onClick={() => void newFolder()} className="h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50 disabled:opacity-50">
              + Folder
            </button>
          </>
        )}
      </div>

      {!q && (
        <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 text-sm">
          {crumbs.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1">
              {i > 0 && <span className="text-neutral-300">/</span>}
              <button type="button" onClick={() => setFolderId(c.id)} className={`rounded px-1.5 py-0.5 ${i === crumbs.length - 1 ? "font-semibold text-neutral-900" : "text-brand hover:underline"}`}>
                {c.name}
              </button>
            </span>
          ))}
        </nav>
      )}

      {!q && folderId === lib.rootId && recent.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-bold tracking-wide text-neutral-500 uppercase">Recently updated</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((r) => (
              <button key={r.id} type="button" onClick={() => setPreview(r)} className="flex items-center gap-3 rounded-xl bg-white p-3 text-left shadow-sm ring-1 ring-neutral-200/70 hover:ring-brand/40">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600"><Glyph name={kind(r.mime, r.name).icon} size={18} /></span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-neutral-900">{r.name}</span>
                  <span className="block truncate text-xs text-neutral-500">
                    {pathOf(r)} · {fmtDate(r.modified)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-neutral-200/70">
        {q && <div className="border-b border-neutral-100 px-4 py-2 text-xs text-neutral-500">{shown.length} result(s) for &quot;{query}&quot;</div>}
        <ul className="divide-y divide-neutral-100">
          {shown.map((i) => {
            const k = kind(i.mime, i.name);
            return (
              <li key={i.id}>
                <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-50">
                  <button
                    type="button"
                    onClick={() => {
                      if (i.folder) {
                        setFolderId(i.id);
                        setQuery("");
                      } else setPreview(i);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${i.folder ? "text-brand" : "bg-neutral-100 text-neutral-600"}`}><Glyph name={k.icon} size={i.folder ? 22 : 17} /></span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-neutral-900">{i.name}</span>
                      <span className="block truncate text-xs text-neutral-500">
                        {q ? pathOf(i) : i.folder ? `${countIn(i.id)} item(s)` : k.label}
                        {!i.folder && i.size != null && ` · ${fmtSize(i.size)}`}
                        {i.modified && ` · ${fmtDate(i.modified)}`}
                      </span>
                    </span>
                  </button>
                  {!i.folder && (
                    <a href={fileUrl(i.id, true)} title="Download" className="shrink-0 rounded-lg px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900">
                      <Glyph name="download" label="Download" />
                    </a>
                  )}
                </div>
              </li>
            );
          })}
          {shown.length === 0 && <li className="px-4 py-10 text-center text-sm text-neutral-500">{q ? "No documents match." : connectedAs ? "This folder is empty." : "Nothing to show yet."}</li>}
        </ul>
      </section>

      {preview && <Preview item={preview} onClose={() => setPreview(null)} canManage={canManage} />}
    </div>
  );
}
