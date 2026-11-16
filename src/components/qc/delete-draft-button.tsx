"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteQcDraft } from "@/app/actions/qc";

/** Throws a saved (not submitted) QC away, after a confirmation. */
export function DeleteDraftButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm("Delete this saved QC? What was filled in is lost.")) return;
        start(async () => {
          await deleteQcDraft(id);
          router.refresh();
        });
      }}
      className="rounded-lg px-2 py-1.5 text-xs text-neutral-500 hover:text-red-600 disabled:opacity-50"
    >
      {pending ? "…" : "Delete"}
    </button>
  );
}
