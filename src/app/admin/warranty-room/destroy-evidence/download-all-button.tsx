"use client";

import { useState } from "react";
import { downloadZip } from "client-zip";

type ZipFile = { url: string; name: string };

/**
 * One click downloads every video for this branch as a single zip. The
 * videos are fetched from their signed URLs in the browser and zipped there
 * (stored, not compressed - mp4 is already compressed) so nothing large
 * passes through the server. Opening the signed URLs directly would just
 * play the video in a tab instead of downloading it.
 */
export function DownloadAllButton({ files, zipName }: { files: ZipFile[]; zipName: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      const entries: { name: string; lastModified: Date; input: Blob }[] = [];
      for (let i = 0; i < files.length; i++) {
        setStatus(`Fetching video ${i + 1} of ${files.length}...`);
        const res = await fetch(files[i].url);
        if (!res.ok) throw new Error(`Video ${i + 1} could not be fetched (${res.status}).`);
        entries.push({ name: files[i].name, lastModified: new Date(), input: await res.blob() });
      }
      setStatus("Building zip...");
      const blob = await downloadZip(entries).blob();

      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = zipName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
      setStatus(null);
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  }

  if (files.length === 0) return null;

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
      >
        {busy ? "Preparing zip..." : `Download all ${files.length} video(s) as zip`}
      </button>
      {status && <p className="text-xs text-neutral-500">{status}</p>}
      {error && <p className="max-w-[260px] text-xs text-red-600">{error}</p>}
    </div>
  );
}
