"use client";

import { useState } from "react";
import { Glyph } from "@/components/ui/glyph";

type DirHandle = {
  getDirectoryHandle: (name: string, o?: { create?: boolean }) => Promise<DirHandle>;
  getFileHandle: (name: string, o?: { create?: boolean }) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array> & { close?: () => Promise<void> }> }>;
};
type PickerWindow = Window & { showDirectoryPicker?: (o?: { mode?: "readwrite"; id?: string }) => Promise<DirHandle> };

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "_").trim() || "file";

/**
 * One click: every photo, video and PDF of the claim, as normal files (no ZIP). On a computer with Chrome or Edge the
 * person picks where to save and the files go into a folder named after the claim; elsewhere each file is downloaded on
 * its own (the browser may ask once to allow several downloads). Files with the same name get "(2)", "(3)"...
 */
export function DownloadAllButton({ files, zipName }: { files: { id: string; name: string }[]; zipName: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uniqueNames = () => {
    const used = new Map<string, number>();
    return files.map((f) => {
      const name = safe(f.name);
      const n = (used.get(name) ?? 0) + 1;
      used.set(name, n);
      return n === 1 ? name : name.replace(/(\.[^.]+)?$/, ` (${n})$1`);
    });
  };

  /** Into a folder the person picks (Chrome / Edge on a computer). */
  async function toFolder(pick: NonNullable<PickerWindow["showDirectoryPicker"]>) {
    let root: DirHandle;
    try {
      root = await pick({ mode: "readwrite", id: "tech-claim-files" });
    } catch {
      return; // cancelled
    }
    const dir = await root.getDirectoryHandle(safe(zipName), { create: true });
    const names = uniqueNames();
    for (let i = 0; i < files.length; i++) {
      setStatus(`Saving ${i + 1} of ${files.length}…`);
      const res = await fetch(`/api/tech-claims/file/${files[i].id}`);
      if (!res.ok || !res.body) throw new Error(`Could not read "${files[i].name}" from Google Drive.`);
      const handle = await dir.getFileHandle(names[i], { create: true });
      await res.body.pipeTo(await handle.createWritable());
    }
    setStatus(null);
    setDone(`Saved ${files.length} files in the folder "${safe(zipName)}".`);
  }

  /** Each file on its own (other browsers, phones). */
  async function oneByOne() {
    for (let i = 0; i < files.length; i++) {
      setStatus(`Downloading ${i + 1} of ${files.length}…`);
      const a = document.createElement("a");
      a.href = `/api/tech-claims/file/${files[i].id}?download=1`;
      a.download = files[i].name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 900)); // browsers drop clicks that come too fast
    }
    setStatus(null);
    setDone(`${files.length} files sent to your Downloads folder.`);
  }

  const [done, setDone] = useState<string | null>(null);

  async function run() {
    setError(null);
    setDone(null);
    try {
      const pick = (window as PickerWindow).showDirectoryPicker;
      if (pick) await toFolder(pick.bind(window));
      else await oneByOne();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The download failed - please try again.");
    } finally {
      setStatus(null);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={!!status || !files.length}
        onClick={() => void run()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
      >
        <Glyph name="download" />
        {status ?? `Download all (${files.length})`}
      </button>
      {done && <span className="text-xs text-emerald-700">{done}</span>}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
