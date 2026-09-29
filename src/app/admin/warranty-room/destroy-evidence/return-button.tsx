"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { returnDestroyEvidence } from "./actions";

export function ReturnButton({ cycleId, branchId }: { cycleId: string; branchId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleClick = () => {
    if (!window.confirm("Send this back to the branch to add or remove videos? It will no longer count as submitted until they resubmit.")) return;
    setError(null);
    startTransition(async () => {
      const result = await returnDestroyEvidence(cycleId, branchId);
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
        className="text-xs font-medium text-neutral-500 hover:text-neutral-800 disabled:opacity-50"
      >
        {isPending ? "Returning..." : "Return"}
      </button>
      {error && <p className="max-w-[220px] text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
