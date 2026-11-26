"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * A download (PDF or Excel) that stays on the page: the file is fetched and saved, then the page refreshes so the
 * "Exported already" marks show the new export.
 */
export function QcExportButton({ href, label, primary }: { href: string; label: string; primary?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(href, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "The export failed. Try again.");
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(cd)?.[1] ?? "QC report");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The export failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className={`rounded-lg px-3.5 py-2 text-sm font-semibold shadow-sm disabled:opacity-60 ${primary ? "bg-brand text-white hover:bg-brand-dark" : "border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50"}`}
      >
        {busy ? "Preparing…" : label}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}

/** The "Exported already" mark. */
export function ExportedPill({ title }: { title: string }) {
  return (
    <span title={title} className="inline-block rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-sky-800 ring-1 ring-sky-200">
      ✓ Exported already
    </span>
  );
}
