"use client";

import { useState } from "react";

/**
 * Shared by every Warranty Room report download (Do Not Scrap, Scrapped
 * List, Flagged to be Scrapped) - all three fetch a server-generated xlsx
 * file route and trigger a save, reading claim/part counts back from
 * response headers. No preview page; clicking downloads directly.
 */
export function ReportDownloadButton({
  endpoint,
  branchId,
  label,
  description,
  filenameFallback,
}: {
  endpoint: string;
  branchId?: string;
  label: string;
  description: string;
  filenameFallback: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const url = branchId ? `${endpoint}?branch=${encodeURIComponent(branchId)}` : endpoint;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ? `Could not generate the report: ${body.error}` : `Could not generate the report (${res.status}).`);
      }
      const claimCount = res.headers.get("X-Claim-Count") ?? "?";
      const partCount = res.headers.get("X-Part-Count") ?? "?";
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? filenameFallback;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
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
        {loading ? "Preparing..." : `${label} →`}
      </button>
      <p className="mt-1 text-xs text-neutral-500">{description}</p>
      {summary && <p className="mt-1 text-xs text-emerald-700">{summary}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
