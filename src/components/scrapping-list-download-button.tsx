"use client";

import { useState } from "react";

/**
 * No preview page - clicking downloads the Excel report directly (generated
 * server-side, see /api/warranty-room/download/scrapping-list). branchId is
 * only used by the officer's branch-picker page - a branch admin's own
 * branch is always resolved server-side from their session, ignoring it.
 */
export function ScrappingListDownloadButton({ branchId }: { branchId?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const endpoint = branchId
        ? `/api/warranty-room/download/scrapping-list?branch=${encodeURIComponent(branchId)}`
        : "/api/warranty-room/download/scrapping-list";
      const res = await fetch(endpoint);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ? `Could not generate the report: ${body.error}` : `Could not generate the report (${res.status}).`);
      }
      const claimCount = res.headers.get("X-Claim-Count") ?? "?";
      const partCount = res.headers.get("X-Part-Count") ?? "?";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "Scrapping_List.xlsx";
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
        {loading ? "Preparing..." : "Scrapping List →"}
      </button>
      <p className="mt-1 text-xs text-neutral-500">Every claim flagged to scrap, presumed scrapped, or scrapped. Downloads as Excel.</p>
      {summary && <p className="mt-1 text-xs text-emerald-700">{summary}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
