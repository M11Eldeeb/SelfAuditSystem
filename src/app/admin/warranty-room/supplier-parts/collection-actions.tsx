"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markSupplierCollectionSent, deleteSupplierCollection } from "./actions";

export function CollectionActions({
  collectionId,
  status,
  redirectAfterDelete,
}: {
  collectionId: string;
  status: string;
  redirectAfterDelete?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleMarkSent = () => {
    if (!window.confirm("Mark this collection as sent to the supplier? This skips the branch's own signature/video handover.")) return;
    setError(null);
    startTransition(async () => {
      const result = await markSupplierCollectionSent(collectionId);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  };

  const handleDelete = () => {
    if (!window.confirm("Delete this collection and all its part rows? This can't be undone.")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteSupplierCollection(collectionId, redirectAfterDelete);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-3">
        {status === "pending" && (
          <button
            type="button"
            onClick={handleMarkSent}
            disabled={isPending}
            className="text-xs font-medium text-emerald-700 hover:text-emerald-900 disabled:opacity-50"
          >
            Mark as sent
          </button>
        )}
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
      {error && <p className="max-w-[220px] text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
