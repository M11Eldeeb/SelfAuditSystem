"use client";

import { useActionState } from "react";
import { decideScrapRequest } from "./actions";

type Part = { part_no: string; part_name: string | null; quantity: number | null };

export function ScrapReviewCard({
  requestId,
  claimNumber,
  workOrderNo,
  branchName,
  videoUrl,
  parts,
  stage,
}: {
  requestId: string;
  claimNumber: string;
  workOrderNo: string | null;
  branchName: string;
  videoUrl: string | null;
  parts: Part[];
  stage: "review" | "manufacturer";
}) {
  const boundDecide = decideScrapRequest.bind(null, requestId);
  const [state, formAction, pending] = useActionState(boundDecide, undefined);

  const actions =
    stage === "review"
      ? [
          { value: "returned_to_branch", label: "Return to branch", className: "border border-amber-300 text-amber-700 hover:bg-amber-50" },
          { value: "rejected", label: "Reject", className: "border border-red-300 text-red-700 hover:bg-red-50" },
          { value: "pending_manufacturer", label: "Submit to manufacturer", className: "bg-brand text-white hover:bg-brand-dark" },
        ]
      : [
          { value: "manufacturer_returned", label: "Return", className: "border border-amber-300 text-amber-700 hover:bg-amber-50" },
          { value: "manufacturer_rejected", label: "Reject", className: "border border-red-300 text-red-700 hover:bg-red-50" },
          { value: "approved", label: "Approve", className: "bg-emerald-600 text-white hover:bg-emerald-700" },
        ];

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <div>
        <p className="text-sm font-semibold text-neutral-900">
          Claim {claimNumber}
          {workOrderNo && <span className="ml-2 font-normal text-neutral-500">&middot; WO {workOrderNo}</span>}
        </p>
        <p className="text-xs text-neutral-500">{branchName}</p>
      </div>

      <div>
        <p className="text-xs font-medium text-neutral-700">Parts</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-neutral-700">
          {parts.map((p) => (
            <li key={p.part_no}>
              {p.part_name ?? p.part_no} ({p.part_no}){p.quantity != null ? ` × ${p.quantity}` : ""}
            </li>
          ))}
        </ul>
      </div>

      {videoUrl ? (
        <video src={videoUrl} controls className="w-full max-w-md rounded-md border border-neutral-200" />
      ) : (
        <p className="text-xs text-neutral-400">No video on file.</p>
      )}

      <form action={formAction} className="space-y-2">
        <label htmlFor={`comment-${requestId}`} className="text-xs font-medium text-neutral-700">
          Comment
        </label>
        <textarea
          id={`comment-${requestId}`}
          name="comment"
          rows={2}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <button
              key={a.value}
              type="submit"
              name="new_status"
              value={a.value}
              disabled={pending}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${a.className}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
