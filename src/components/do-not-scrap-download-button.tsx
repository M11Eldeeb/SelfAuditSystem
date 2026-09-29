"use client";

import { useState } from "react";
import { fetchDoNotScrapRows } from "@/app/audit/warranty-room/download-actions";
import { generateDoNotScrapExcel } from "@/lib/warranty-room/do-not-scrap-excel";

/** No preview page - clicking downloads the Excel report directly. */
export function DoNotScrapDownloadButton({ branchName }: { branchName: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchDoNotScrapRows();
      await generateDoNotScrapExcel(branchName, rows);
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
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
