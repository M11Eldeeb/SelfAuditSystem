"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteDestroyEvidenceVideos } from "./actions";

export function DeleteVideosButton({ cycleId, branchId, count }: { cycleId: string; branchId: string; count: number }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleClick = () => {
    if (
      !window.confirm(
        `Permanently delete ${count} video(s) for this branch and cycle from storage? This cannot be undone - only do this after downloading them.`
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const result = await deleteDestroyEvidenceVideos(cycleId, branchId);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 shadow-sm transition-colors hover:bg-red-50 disabled:opacity-50"
      >
        {isPending ? "Deleting..." : "Delete videos"}
      </button>
      {error && <p className="max-w-[220px] text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
