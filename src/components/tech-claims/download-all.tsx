"use client";

import { useState } from "react";
import { Glyph } from "@/components/ui/glyph";

/**
 * One click: every photo, video and PDF of the claim in one ZIP (built in the browser as the files arrive, so nothing
 * big passes through the server twice). Files with the same name get "(2)", "(3)"...
 */
export function DownloadAllButton({ files, zipName }: { files: { id: string; name: string }[]; zipName: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    try {
      const { downloadZip } = await import("client-zip");
      const used = new Map<string, number>();
      const unique = (name: string) => {
        const n = (used.get(name) ?? 0) + 1;
        used.set(name, n);
        return n === 1 ? name : name.replace(/(\.[^.]+)?$/, ` (${n})$1`);
      };
      async function* entries() {
        for (let i = 0; i < files.length; i++) {
          setStatus(`Adding ${i + 1} of ${files.length}…`);
          const res = await fetch(`/api/tech-claims/file/${files[i].id}?download=1`);
          if (!res.ok) throw new Error(`Could not read "${files[i].name}" from Google Drive.`);
          yield { name: unique(files[i].name), input: res };
        }
      }
      const blob = await downloadZip(entries()).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${zipName.replace(/[\\/:*?"<>|]+/g, "_")}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The download failed - please try again.");
    } finally {
      setStatus(null);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={!!status || !files.length}
        onClick={() => void run()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
      >
        <Glyph name="download" />
        {status ?? `Download all (${files.length})`}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
