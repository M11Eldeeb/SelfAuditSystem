type Part = { part_no: string; part_name: string | null; quantity: number | null };

const STATUS_LABELS: Record<string, string> = {
  pending_branch: "Awaiting your submission",
  returned_to_branch: "Returned to you - please redo and resubmit",
  manufacturer_returned: "Returned by the manufacturer - please redo and resubmit",
};

/**
 * Read-only claim/parts summary - video upload and submission happen once,
 * together for every pending claim, via BulkScrapVideoUpload above this list
 * (not per-card anymore, per the branch's request to stop uploading one
 * video at a time).
 */
export function ScrapRequestCard({
  claimNumber,
  workOrderNo,
  status,
  parts,
  lastComment,
}: {
  claimNumber: string;
  workOrderNo: string | null;
  status: string;
  parts: Part[];
  lastComment: string | null;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-neutral-900">
            Claim {claimNumber}
            {workOrderNo && <span className="ml-2 font-normal text-neutral-500">&middot; WO {workOrderNo}</span>}
          </p>
          <p className="text-xs text-amber-700">{STATUS_LABELS[status] ?? status}</p>
        </div>
      </div>

      {lastComment && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-medium">Comment:</span> {lastComment}
        </p>
      )}

      <div>
        <p className="text-xs font-medium text-neutral-700">Parts to destroy</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-neutral-700">
          {parts.map((p) => (
            <li key={p.part_no}>
              {p.part_name ?? p.part_no} ({p.part_no}){p.quantity != null ? ` × ${p.quantity}` : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
