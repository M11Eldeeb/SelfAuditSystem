"use client";

import { useState, useTransition } from "react";
import { deleteCycle } from "./actions";

export function DeleteCycleButton({
  cycleId,
  cycleMonth,
  hasStartedWork,
}: {
  cycleId: string;
  cycleMonth: string;
  hasStartedWork: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    const message = hasStartedWork
      ? `Delete the ${cycleMonth} audit cycle? Branches have already submitted or started answers - all of that work will be permanently lost. This can't be undone.`
      : `Delete the ${cycleMonth} audit cycle? This can't be undone.`;
    if (!window.confirm(message)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteCycle(cycleId);
      if (result.error) setError(result.error);
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
      >
        {isPending ? "Deleting..." : "Delete"}
      </button>
      {error && <p className="max-w-[220px] text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
