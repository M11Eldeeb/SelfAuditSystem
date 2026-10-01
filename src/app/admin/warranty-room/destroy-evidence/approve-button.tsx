"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveDestroyEvidence } from "./actions";

export function ApproveButton({ cycleId, branchId }: { cycleId: string; branchId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleClick = () => {
    if (!window.confirm("Approve? This moves this branch's currently-flagged parts to the Already Scrapped List and permanently deletes these video files - only do this after downloading them.")) return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await approveDestroyEvidence(cycleId, branchId);
      if (result.error) setError(result.error);
      else {
        setSuccess(`${result.scrappedCount ?? 0} part(s) moved to the Already Scrapped List.`);
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded-lg bg-brand shadow-sm shadow-brand/25 hover:shadow-md hover:shadow-brand/30 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
      >
        {isPending ? "Approving..." : "Approve"}
      </button>
      {success && <p className="max-w-[220px] text-right text-xs text-emerald-700">{success}</p>}
      {error && <p className="max-w-[220px] text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
