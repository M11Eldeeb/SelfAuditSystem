"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reopenInternalAudit } from "../../actions";

/** "Review & edit" on a finalized internal audit: reopens it (after a confirm) and goes back to the claims. */
export function ReopenAuditButton({ auditId }: { auditId: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function reopen() {
    setError(null);
    start(async () => {
      const r = await reopenInternalAudit(auditId);
      if (r.error) return setError(r.error);
      router.push(`/admin/internal-audit/${auditId}`);
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
      {error && <span className="text-sm text-red-600">{error}</span>}
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-800 shadow-sm ring-1 ring-neutral-300 hover:bg-neutral-50"
      >
        Review &amp; edit
      </button>
      {asking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-neutral-900">Reopen this audit?</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-600">
              <li>The audit goes back to in progress: answers, parts, branch operation and files can be changed.</li>
              <li>The branch does not see the result until it is finalized again.</li>
              <li>Finalizing again works out the score again and replaces the report (also on Drive). Names, remarks, recommendations and the closing statement are kept for you to edit.</li>
            </ul>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAsking(false)} disabled={pending} className="rounded-lg px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-100">
                Cancel
              </button>
              <button type="button" onClick={reopen} disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {pending ? "Reopening..." : "Reopen & edit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
