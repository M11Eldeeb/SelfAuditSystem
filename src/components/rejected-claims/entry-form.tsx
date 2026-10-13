"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { checkWorkOrder, createRejectedClaim, type WorkOrderCheck } from "@/app/actions/rejected-claims";
import { REJECTED_INFO_MAX, REJECTED_LIST_ITEM_MAX, REJECTED_LIST_MAX_ITEMS, REJECTED_REASON_MAX, normalizeWorkOrder } from "@/lib/rejected-claims";
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
  // The optional "additional information" section.
  const [showInfo, setShowInfo] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [serviceAdvisor, setServiceAdvisor] = useState("");
  const [teamLeader, setTeamLeader] = useState("");
  const [labours, setLabours] = useState<string[]>([""]);
  const [parts, setParts] = useState<string[]>([""]);
  // Set when the work order typed is already in the diary: the warning pop-up is showing.
  const [duplicate, setDuplicate] = useState<NonNullable<WorkOrderCheck["duplicate"]> | null>(null);

  const branch = branches.find((b) => b.id === (fixedBranchId ?? branchId));
  const preview = branch && workOrder.trim() ? normalizeWorkOrder(workOrder, branch.code) : null;

  /**
   * Uploads the files and saves. `finalWorkOrder` is what gets stored: the number as
   * typed, or - for a repeat the person confirmed - <number>-1, -2, -3 ...
   */
  async function save(finalWorkOrder: string, duplicateOf?: string) {
    if (!branch) return;
    setSaving(true);
    setError(null);
    setExistingId(null);
    try {
      const uploaded = await attachments.upload({ entryId, branchId: branch.id, workOrder: finalWorkOrder });
      const result = await createRejectedClaim({
        id: entryId,
        branchId: branch.id,
        workOrder: finalWorkOrder,
        duplicateOf,
        claimNo,
        date,
        reason,
        customerName,
        vehicleModel,
        serviceAdvisor,
        teamLeader,
        labours,
        parts,
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

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    setExistingId(null);
    if (!branch) return setError("Choose the branch.");
    if (!preview || preview.value === undefined) return setError(preview?.error ?? "Enter the work order number.");
    if (!reason.trim()) return setError("Write the reason for the rejection.");

    // Ask first whether this work order is already in the diary - before any file is uploaded.
    setSaving(true);
    let check: WorkOrderCheck;
    try {
      check = await checkWorkOrder({ branchId: branch.id, workOrder });
    } catch {
      setSaving(false);
      return setError("Could not check the work order - please try again.");
    }
    setSaving(false);
    if (check.error || !check.workOrder) return setError(check.error ?? "Could not check the work order.");
    if (check.duplicate) return setDuplicate(check.duplicate);
    await save(check.workOrder);
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

          <div className="rounded-lg border border-neutral-200">
            <button
              type="button"
              onClick={() => setShowInfo((v) => !v)}
              aria-expanded={showInfo}
              aria-controls="rc-extra"
              className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50"
            >
              <span className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-brand/10 text-brand">
                  <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d={showInfo ? "M4 10h12" : "M10 4v12M4 10h12"} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  </svg>
                </span>
                {showInfo ? "Hide additional information" : "Add additional information"}
                <span className="text-xs font-normal text-neutral-500">(optional)</span>
              </span>
            </button>

            {showInfo && (
              <div id="rc-extra" className="space-y-4 border-t border-neutral-100 p-3">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField id="rc-customer" label="Customer name" value={customerName} onChange={setCustomerName} disabled={saving} />
                  <TextField id="rc-model" label="Vehicle model" value={vehicleModel} onChange={setVehicleModel} disabled={saving} />
                  <TextField id="rc-advisor" label="Service advisor name" value={serviceAdvisor} onChange={setServiceAdvisor} disabled={saving} />
                  <TextField id="rc-leader" label="Team leader name" value={teamLeader} onChange={setTeamLeader} disabled={saving} />
                </div>
                <ListField
                  label="Labour description"
                  addLabel="Add another labour"
                  placeholder="What work was done"
                  values={labours}
                  onChange={setLabours}
                  disabled={saving}
                />
                <ListField
                  label="Parts needed for the repair"
                  addLabel="Add another part"
                  placeholder="Part name or number"
                  values={parts}
                  onChange={setParts}
                  disabled={saving}
                />
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-neutral-700">Service history</p>
                  <AttachmentPicker
                    state={attachments}
                    kind="service_history"
                    label="Attach service history"
                    disabled={saving}
                    driveReady={driveReady}
                  />
                </div>
              </div>
            )}
          </div>

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

      {duplicate && (
        <DuplicateDialog
          duplicate={duplicate}
          basePath={basePath}
          onCancel={() => setDuplicate(null)}
          onConfirm={() => {
            const d = duplicate;
            setDuplicate(null);
            void save(d.suggested, d.base);
          }}
        />
      )}
    </section>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium text-neutral-700">
        {label}
      </label>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} maxLength={REJECTED_INFO_MAX} disabled={disabled} className={inputClass} />
    </div>
  );
}

/** A list of one-line entries (labours, parts) with a plus button to add another row. */
function ListField({
  label,
  addLabel,
  placeholder,
  values,
  onChange,
  disabled,
}: {
  label: string;
  addLabel: string;
  placeholder: string;
  values: string[];
  onChange: (v: string[]) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-neutral-700">{label}</p>
      <ul className="space-y-2">
        {values.map((value, i) => (
          <li key={i} className="flex items-center gap-2">
            <input
              value={value}
              onChange={(e) => onChange(values.map((v, j) => (j === i ? e.target.value : v)))}
              maxLength={REJECTED_LIST_ITEM_MAX}
              placeholder={placeholder}
              aria-label={`${label} ${i + 1}`}
              disabled={disabled}
              className={inputClass}
            />
            {values.length > 1 && (
              <button
                type="button"
                onClick={() => onChange(values.filter((_, j) => j !== i))}
                disabled={disabled}
                aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-red-600 disabled:opacity-50"
              >
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => onChange([...values, ""])}
        disabled={disabled || values.length >= REJECTED_LIST_MAX_ITEMS}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
      >
        <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        {addLabel}
      </button>
    </div>
  );
}

const dateLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Pop-up shown when the work order is already in the diary: open the original, cancel, or save a numbered repeat. */
function DuplicateDialog({
  duplicate,
  basePath,
  onCancel,
  onConfirm,
}: {
  duplicate: NonNullable<WorkOrderCheck["duplicate"]>;
  basePath: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-backdrop absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onCancel} aria-hidden="true" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dup-title"
        aria-describedby="dup-text"
        className="modal-card relative w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-2xl"
      >
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-700 ring-8 ring-amber-50/60">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 4.5l9 15.5H3L12 4.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            <path d="M12 10v4.2M12 17.2v.1" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
        </div>
        <h2 id="dup-title" className="text-lg font-bold text-neutral-900">
          This work order is already in the diary
        </h2>
        <p id="dup-text" className="mt-2 text-sm text-neutral-700">
          <span className="font-semibold text-neutral-900">{duplicate.base}</span> was logged
          {duplicate.existingDate ? ` on ${dateLabel(duplicate.existingDate)}` : ""}
          {duplicate.existingBy ? ` by ${duplicate.existingBy}` : ""}. If you continue, this one will be saved as a repeat:{" "}
          <span className="font-semibold text-neutral-900">{duplicate.suggested}</span>.
        </p>
        <p className="mt-2 text-xs text-neutral-500">Just adding a note to the first one? Open it and add a comment instead.</p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark"
          >
            Save as {duplicate.suggested}
          </button>
          <Link
            href={`${basePath}/${duplicate.existingId}`}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-center text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            Open {duplicate.base}
          </Link>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
