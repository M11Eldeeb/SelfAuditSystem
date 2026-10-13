"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createRejectedClaim } from "@/app/actions/rejected-claims";
import { REJECTED_REASON_MAX, normalizeWorkOrder } from "@/lib/rejected-claims";
import { AttachmentPicker, useAttachments } from "./use-attachments";

type BranchOption = { id: string; name: string; code: string };

const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm transition-colors placeholder:text-neutral-500 focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none disabled:opacity-60";

/** Local calendar date as YYYY-MM-DD (not UTC, so late evenings don't jump a day). */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * "Log a rejected claim": a collapsed bar that opens into the entry form. A
 * branch admin logs for their own branch (fixed); an officer chooses the branch.
 */
export function EntryForm({
  branches,
  fixedBranchId,
  basePath,
  driveReady,
}: {
  branches: BranchOption[];
  /** Set for a branch admin: the only branch they can log for. */
  fixedBranchId?: string;
  basePath: string;
  /** Whether Google Drive is connected (attachments need it). */
  driveReady: boolean;
}) {
  const router = useRouter();
  const attachments = useAttachments();
  const [open, setOpen] = useState(false);
  const [entryId] = useState(() => crypto.randomUUID());
  const [branchId, setBranchId] = useState(fixedBranchId ?? "");
  const [workOrder, setWorkOrder] = useState("");
  const [claimNo, setClaimNo] = useState("");
  const [date, setDate] = useState(todayLocal);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const branch = branches.find((b) => b.id === (fixedBranchId ?? branchId));
  const preview = branch && workOrder.trim() ? normalizeWorkOrder(workOrder, branch.code) : null;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    setExistingId(null);
    if (!branch) return setError("Choose the branch.");
    if (!preview || preview.value === undefined) return setError(preview?.error ?? "Enter the work order number.");
    if (!reason.trim()) return setError("Write the reason for the rejection.");

    setSaving(true);
    try {
      const uploaded = await attachments.upload({ entryId, branchId: branch.id, workOrder });
      const result = await createRejectedClaim({
        id: entryId,
        branchId: branch.id,
        workOrder,
        claimNo,
        date,
        reason,
        attachments: uploaded,
      });
      if (result.id) {
        router.push(`${basePath}/${result.id}`);
        return;
      }
      setError(result.error ?? "Could not save the entry.");
      setExistingId(result.existingId ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the entry - please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-neutral-200/70 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-neutral-50"
      >
        <span className="flex items-center gap-2.5 text-sm font-semibold text-neutral-900">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          Log a rejected claim
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className={`text-neutral-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <form onSubmit={handleSave} className="space-y-4 border-t border-neutral-100 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="rc-branch" className="text-xs font-medium text-neutral-700">
                Branch
              </label>
              {fixedBranchId ? (
                <p id="rc-branch" className="flex h-[38px] items-center rounded-lg bg-neutral-100 px-3 text-sm text-neutral-800">
                  {branch?.name ?? "Your branch"}
                </p>
              ) : (
                <select id="rc-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={saving} className={inputClass}>
                  <option value="">Choose a branch</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="rc-date" className="text-xs font-medium text-neutral-700">
                Rejection date
              </label>
              <input
                id="rc-date"
                type="date"
                value={date}
                max={todayLocal()}
                onChange={(e) => setDate(e.target.value)}
                disabled={saving}
                className={inputClass}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="rc-wo" className="text-xs font-medium text-neutral-700">
                Work order (WIP) number
              </label>
              <input
                id="rc-wo"
                value={workOrder}
                onChange={(e) => setWorkOrder(e.target.value)}
                placeholder={branch ? `35698 or ${branch.code}-35698` : "35698"}
                maxLength={40}
                disabled={saving}
                className={inputClass}
              />
              {preview && (
                <p className={`text-xs ${preview.error ? "text-red-600" : "text-neutral-500"}`}>
                  {preview.error ?? (
                    <>
                      Saved as <span className="font-semibold text-neutral-800">{preview.value}</span>
                    </>
                  )}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="rc-claim" className="text-xs font-medium text-neutral-700">
                Claim number <span className="font-normal text-neutral-500">(optional)</span>
              </label>
              <input
                id="rc-claim"
                value={claimNo}
                onChange={(e) => setClaimNo(e.target.value)}
                maxLength={40}
                disabled={saving}
                className={inputClass}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="rc-reason" className="text-xs font-medium text-neutral-700">
              Reason for the rejection
            </label>
            <textarea
              id="rc-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={REJECTED_REASON_MAX}
              rows={4}
              disabled={saving}
              placeholder="Why was this claim rejected? Be specific - this is what you will rely on if the customer complains later."
              className={`${inputClass} resize-y`}
            />
            <p className="text-right text-xs text-neutral-500">
              {reason.length} / {REJECTED_REASON_MAX}
            </p>
          </div>

          <AttachmentPicker state={attachments} disabled={saving} driveReady={driveReady} />

          {attachments.error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {attachments.error}
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}{" "}
              {existingId && (
                <Link href={`${basePath}/${existingId}`} className="font-semibold underline">
                  Open it
                </Link>
              )}
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-neutral-500">Entries are permanent: they can be commented on but not edited or deleted.</p>
            <div className="flex shrink-0 items-center gap-3">
              {attachments.status && <span className="text-sm text-neutral-500">{attachments.status}</span>}
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark hover:shadow-md disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save to diary"}
              </button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
