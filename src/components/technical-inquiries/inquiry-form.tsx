"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createTechnicalInquiry, prepareInquiryUploads } from "@/app/actions/technical-inquiries";
import { normalizeWorkOrder } from "@/lib/rejected-claims";
import { INQUIRY_MAX_FILES, INQUIRY_MAX_FILE_BYTES, INQUIRY_MODEL_MAX, INQUIRY_TEXT_MAX, VIN_PATTERN } from "@/lib/technical-inquiries";
import { AttachmentPicker, useAttachments, type PrepareUploads } from "@/components/rejected-claims/use-attachments";

type BranchOption = { id: string; name: string; code: string };

const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm transition-colors placeholder:text-neutral-500 focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none disabled:opacity-60";

/**
 * "New technical inquiry": a collapsed bar that opens into a short checklist of the terms the workshop must meet first.
 * Only when every term is ticked does the inquiry form appear; the confirmation is recorded with the inquiry.
 */
export function InquiryForm({
  branches,
  fixedBranchId,
  basePath,
  driveReady,
  terms,
}: {
  branches: BranchOption[];
  /** Set for a branch admin: the only branch they can submit for. */
  fixedBranchId?: string;
  basePath: string;
  driveReady: boolean;
  terms: string[];
}) {
  const router = useRouter();
  const attachments = useAttachments({
    prepare: prepareInquiryUploads as unknown as PrepareUploads,
    maxFiles: INQUIRY_MAX_FILES,
    maxFileBytes: INQUIRY_MAX_FILE_BYTES,
  });
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState<boolean[]>(() => terms.map(() => false));
  const [confirmed, setConfirmed] = useState(false);
  const [inquiryId] = useState(() => crypto.randomUUID());
  const [branchId, setBranchId] = useState(fixedBranchId ?? "");
  const [workOrder, setWorkOrder] = useState("");
  const [vin, setVin] = useState("");
  const [model, setModel] = useState("");
  const [fault, setFault] = useState("");
  const [actions, setActions] = useState("");
  const [comments, setComments] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const branch = branches.find((b) => b.id === (fixedBranchId ?? branchId));
  const preview = branch && workOrder.trim() ? normalizeWorkOrder(workOrder, branch.code) : null;
  const vinClean = vin.trim().toUpperCase().replace(/\s+/g, "");
  const vinOk = VIN_PATTERN.test(vinClean);
  const allTicked = terms.length > 0 && ticked.every(Boolean);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    if (!branch) return setError("Choose the branch.");
    if (!preview || preview.value === undefined) return setError(preview?.error ?? "Enter the work order number.");
    if (!vinOk) return setError("The VIN must be 17 letters and digits (no I, O or Q).");
    if (!model.trim()) return setError("Enter the vehicle model.");
    if (!fault.trim()) return setError("Describe the fault complaint.");
    if (!actions.trim()) return setError("Write what the workshop has done so far.");

    setSaving(true);
    try {
      const uploaded = await attachments.upload({ inquiryId, branchId: branch.id, workOrder: preview.value });
      const result = await createTechnicalInquiry({
        id: inquiryId,
        branchId: branch.id,
        workOrder: preview.value,
        vin: vinClean,
        model,
        fault,
        actions,
        comments,
        termsConfirmed: true,
        attachments: uploaded,
      });
      if (result.id) {
        router.push(`${basePath}/${result.id}`);
        return;
      }
      setError(result.error ?? "Could not submit the inquiry.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit the inquiry - please try again.");
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
          New technical inquiry
        </span>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className={`text-neutral-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
          <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && !confirmed && (
        <div className="space-y-4 border-t border-neutral-100 p-4">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">Before you submit</h2>
            <p className="text-xs text-neutral-500">Confirm that every point below is done. The technical team can only help once the workshop has completed them.</p>
          </div>
          {terms.length === 0 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">No terms have been set up yet - ask a warranty officer.</p>
          ) : (
            <ul className="space-y-2">
              {terms.map((t, i) => (
                <li key={i}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 px-3 py-2.5 text-sm text-neutral-800 transition-colors hover:bg-neutral-50">
                    <input
                      type="checkbox"
                      checked={ticked[i] ?? false}
                      onChange={(e) => setTicked((cur) => cur.map((v, j) => (j === i ? e.target.checked : v)))}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 text-brand focus:ring-brand/30"
                    />
                    <span>{t}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-neutral-500">
              {ticked.filter(Boolean).length} of {terms.length} confirmed
            </p>
            <button
              type="button"
              disabled={!allTicked}
              onClick={() => setConfirmed(true)}
              className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark disabled:opacity-50"
            >
              All done - continue
            </button>
          </div>
        </div>
      )}

      {open && confirmed && (
        <form onSubmit={handleSave} className="space-y-4 border-t border-neutral-100 p-4">
          <p className="flex items-center justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <span>All {terms.length} terms confirmed.</span>
            <button type="button" onClick={() => setConfirmed(false)} className="font-semibold underline" disabled={saving}>
              Review the terms
            </button>
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="ti-branch" className="text-xs font-medium text-neutral-700">
                Branch
              </label>
              {fixedBranchId ? (
                <p id="ti-branch" className="flex h-[38px] items-center rounded-lg bg-neutral-100 px-3 text-sm text-neutral-800">
                  {branch?.name ?? "Your branch"}
                </p>
              ) : (
                <select id="ti-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={saving} className={inputClass}>
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
              <label htmlFor="ti-wo" className="text-xs font-medium text-neutral-700">
                Work order (WIP) number
              </label>
              <input
                id="ti-wo"
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
              <label htmlFor="ti-vin" className="text-xs font-medium text-neutral-700">
                VIN
              </label>
              <input
                id="ti-vin"
                value={vin}
                onChange={(e) => setVin(e.target.value.toUpperCase())}
                maxLength={20}
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="17 characters"
                disabled={saving}
                className={`${inputClass} font-mono tracking-wide`}
              />
              {vinClean.length > 0 && (
                <p className={`text-xs ${vinOk ? "text-emerald-700" : "text-neutral-500"}`}>
                  {vinOk ? "VIN looks right" : `${vinClean.length} of 17 characters${/[IOQ]/.test(vinClean) ? " - a VIN never contains I, O or Q" : ""}`}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="ti-model" className="text-xs font-medium text-neutral-700">
                Vehicle model
              </label>
              <input id="ti-model" value={model} onChange={(e) => setModel(e.target.value)} maxLength={INQUIRY_MODEL_MAX} placeholder="e.g. MG ZS 2024" disabled={saving} className={inputClass} />
            </div>
          </div>

          <TextArea id="ti-fault" label="Fault complaint" value={fault} onChange={setFault} disabled={saving} rows={4} placeholder="What is the customer's complaint and what is the fault?" />
          <TextArea id="ti-actions" label="What actions did the workshop do?" value={actions} onChange={setActions} disabled={saving} rows={4} placeholder="Checks, tests and repairs already done" />
          <TextArea id="ti-comments" label="Comments of the workshop" optional value={comments} onChange={setComments} disabled={saving} rows={3} placeholder="Anything else the technical team should know" />

          <AttachmentPicker state={attachments} disabled={saving} driveReady={driveReady} label="Attach photos, PDFs or videos" />

          {attachments.error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {attachments.error}
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-neutral-500">The inquiry gets its number (TI-0001...) once it is submitted.</p>
            <div className="flex shrink-0 items-center gap-3">
              {attachments.status && <span className="text-sm text-neutral-500">{attachments.status}</span>}
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark hover:shadow-md disabled:opacity-60"
              >
                {saving ? "Submitting..." : "Submit inquiry"}
              </button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}

function TextArea({
  id,
  label,
  value,
  onChange,
  disabled,
  rows,
  placeholder,
  optional,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  rows: number;
  placeholder: string;
  optional?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium text-neutral-700">
        {label} {optional && <span className="font-normal text-neutral-500">(optional)</span>}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={INQUIRY_TEXT_MAX}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder}
        className={`${inputClass} resize-y`}
      />
    </div>
  );
}
