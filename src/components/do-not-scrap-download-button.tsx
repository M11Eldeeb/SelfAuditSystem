"use client";

import { useState } from "react";

/** No preview page - clicking downloads the Excel report directly (generated server-side, see /api/warranty-room/download/do-not-scrap). */
export function DoNotScrapDownloadButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/warranty-room/download/do-not-scrap");
      if (!res.ok) throw new Error(`Could not generate the report (${res.status}).`);
      const claimCount = res.headers.get("X-Claim-Count") ?? "?";
      const partCount = res.headers.get("X-Part-Count") ?? "?";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "Do_Not_Scrap.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setSummary(`${claimCount} claim(s), ${partCount} part row(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate the report.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="text-sm font-medium text-brand hover:underline disabled:opacity-50"
      >
        {loading ? "Preparing..." : "Do not scrap list →"}
      </button>
      <p className="mt-1 text-xs text-neutral-500">Claims to keep on hand - not flagged to scrap, not already scrapped. Downloads as Excel.</p>
      {summary && <p className="mt-1 text-xs text-emerald-700">{summary}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
