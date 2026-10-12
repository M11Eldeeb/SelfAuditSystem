"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { forceFinalizeBranchAudit } from "./actions";

/**
 * Officer-only escape hatch, shown only when the normal Finalize button is
 * disabled - forces a result through with every unanswered question scored
 * 0%, regardless of the cycle deadline. Separate from Finalize (not just a
 * different state of the same button) so it can never be clicked by
 * mistake in place of the normal, safer path.
 */
export function ForceFinalizeButton({ cycleId, branchId }: { cycleId: string; branchId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleClick = () => {
    if (
      !window.confirm(
        "Force finalize this branch now? Every claim question without a reviewed answer, and every branch operations question if the questionnaire was never reviewed, will score 0%. This cannot be undone."
      )
    )
      return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await forceFinalizeBranchAudit(cycleId, branchId);
      if (result?.error) setError(result.error);
      else {
        setSuccess(result?.success ?? "Force-finalized.");
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-4">
      <p className="text-xs text-red-800">
        Not everything has been reviewed. Force finalize anyway - unanswered questions score 0%.
      </p>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded-lg bg-red-600 shadow-sm px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
      >
        {isPending ? "Force finalizing..." : "Force finalize"}
      </button>
      {success && <p className="text-sm text-emerald-700">{success}</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
