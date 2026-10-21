"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { reviewTechClaim, type ReviewDecision } from "@/app/actions/tech-claims";

/** Warranty admin: approve, return to the technician (what to correct), or reject (reason). */
export function ReviewPanel({ claimId }: { claimId: string }) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<ReviewDecision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(d: ReviewDecision) {
    if (d !== "approve" && !comment.trim()) return setError(d === "return" ? "Write what the technician must correct." : "Write the reason for the rejection.");
    if (d === "reject" && !window.confirm("Reject this claim? The technician cannot send it again.")) return;
    setError(null);
    setBusy(d);
    const r = await reviewTechClaim(claimId, d, comment);
    setBusy(null);
    if (r.error) setError(r.error);
    else router.refresh();
  }

  return (
    <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
      <h2 className="font-semibold text-neutral-900">Review</h2>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        placeholder="Comment - required to return or reject"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
      />
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="grid grid-cols-3 gap-2">
        <button type="button" disabled={!!busy} onClick={() => decide("approve")} className="rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy === "approve" ? "..." : "Approve"}
        </button>
        <button type="button" disabled={!!busy} onClick={() => decide("return")} className="rounded-lg bg-amber-500 px-3 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50">
          {busy === "return" ? "..." : "Return"}
        </button>
        <button type="button" disabled={!!busy} onClick={() => decide("reject")} className="rounded-lg bg-red-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
          {busy === "reject" ? "..." : "Reject"}
        </button>
      </div>
    </section>
  );
}
