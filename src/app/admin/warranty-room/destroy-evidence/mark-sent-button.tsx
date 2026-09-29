"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markDestroyEvidenceSent } from "./actions";

export function MarkSentButton({ cycleId, branchId }: { cycleId: string; branchId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleClick = () => {
    if (!window.confirm("Mark as sent? This permanently deletes these video files from storage - only do this after downloading them.")) return;
    setError(null);
    startTransition(async () => {
      const result = await markDestroyEvidenceSent(cycleId, branchId);
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
        className="rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
      >
        {isPending ? "Marking sent..." : "Mark as sent"}
      </button>
      {error && <p className="max-w-[220px] text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
