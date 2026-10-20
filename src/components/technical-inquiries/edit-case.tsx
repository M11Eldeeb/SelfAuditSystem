"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { editTechnicalInquiry, type InquiryEditFields } from "@/app/actions/technical-inquiries";
import { AFTER_REPAIR_LABEL, INQUIRY_TEXT_MAX, OCCURRENCE_LABEL, SYSTEMS, SYSTEM_LABEL, VEHICLE_LOCATION_LABEL } from "@/lib/technical-inquiries";

const inputClass = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none disabled:opacity-60";

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block space-y-1 ${wide ? "sm:col-span-2" : ""}`}>
      <span className="text-xs font-medium text-neutral-700">{label}</span>
      {children}
    </label>
  );
}

/**
 * The case details card, editable in place (the supervisor / branch admin, the team leader on his own returned or waiting
 * case, officers): "Edit" turns the details into fields right where they are; work orders, files and the reasons stay as
 * they are below. The version before the edit is kept; the technical team and officers see it under "Edit history".
 */
export function EditableCase({
  inquiryId,
  initial,
  highlight = false,
  view,
  fixed,
}: {
  inquiryId: string;
  initial: InquiryEditFields;
  highlight?: boolean;
  /** The card as everyone sees it. */
  view: React.ReactNode;
  /** What cannot be edited here (reasons, work orders, files) - shown under the fields while editing. */
  fixed: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(highlight);
  const [f, setF] = useState<InquiryEditFields>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const set = <K extends keyof InquiryEditFields>(k: K) => (v: InquiryEditFields[K]) => setF((p) => ({ ...p, [k]: v }));
  const text = (k: keyof InquiryEditFields, rows = 0) =>
    rows ? (
      <textarea value={String(f[k] ?? "")} onChange={(e) => set(k)(e.target.value as never)} rows={rows} maxLength={INQUIRY_TEXT_MAX} disabled={pending} className={inputClass} />
    ) : (
      <input value={String(f[k] ?? "")} onChange={(e) => set(k)(e.target.value as never)} disabled={pending} className={inputClass} />
    );

  if (!open) {
    return (
      <section className="relative space-y-4 rounded-xl border border-neutral-200/70 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-end gap-3">
          {saved && <span className="text-xs text-emerald-700">Saved - the previous version is kept.</span>}
          <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-800 shadow-sm hover:bg-neutral-50">
            ✎ Edit
          </button>
        </div>
        {view}
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-xl border-2 border-brand/40 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-900">Editing the case details</h2>
        <p className="text-xs text-neutral-500">Work orders and files cannot be changed here - add new files or results as a comment.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="VIN">{text("vin")}</Field>
        <Field label="Plate number">{text("plate_number")}</Field>
        <Field label="Vehicle model">{text("vehicle_model")}</Field>
        <Field label="Mileage (km)">
          <input value={String(f.mileage_km)} inputMode="numeric" onChange={(e) => set("mileage_km")(Number(e.target.value.replace(/[^0-9]/g, "")) || 0)} disabled={pending} className={inputClass} />
        </Field>
        <Field label="Vehicle system">
          <select value={f.system} onChange={(e) => set("system")(e.target.value)} disabled={pending} className={inputClass}>
            {SYSTEMS.map((s) => (
              <option key={s} value={s}>
                {SYSTEM_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Where is the car?">
          <select value={f.vehicle_location} onChange={(e) => set("vehicle_location")(e.target.value)} disabled={pending} className={inputClass}>
            {Object.entries(VEHICLE_LOCATION_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fault codes (DTC)">{text("dtc_codes")}</Field>
        <Field label="Software / ECU version">{text("software_version")}</Field>
        <Field label="The concern is">
          <select value={f.occurrence} onChange={(e) => set("occurrence")(e.target.value)} disabled={pending} className={inputClass}>
            {Object.entries(OCCURRENCE_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Other condition it happens in">{text("occurrence_conditions")}</Field>
        <Field label="First noticed by the customer">{text("concern_first_noticed")}</Field>
        <Field label="Phone / extension of the person escalating">{text("responsible_phone")}</Field>
        <Field label="Related to a previous repair">
          <select value={f.after_previous_repair} onChange={(e) => set("after_previous_repair")(e.target.value)} disabled={pending} className={inputClass}>
            {Object.entries(AFTER_REPAIR_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Previous repair details">{text("previous_repair_details")}</Field>
        <Field label="Customer concern" wide>
          {text("fault_complaint", 4)}
        </Field>
        <Field label="Parts already replaced" wide>
          {text("parts_replaced", 2)}
        </Field>
        <Field label="Comments of the workshop" wide>
          {text("workshop_comments", 3)}
        </Field>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="sticky bottom-2 z-10 flex items-center gap-2 rounded-lg bg-white/95 py-1">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await editTechnicalInquiry(inquiryId, f);
              if (res.error) return setError(res.error);
              setSaved(true);
              setOpen(false);
              router.refresh();
            })
          }
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save the changes"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setF(initial);
            setOpen(false);
          }}
          className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
        >
          Cancel
        </button>
      </div>
      <div className="space-y-4 border-t border-neutral-100 pt-4 opacity-80">{fixed}</div>
    </section>
  );
}
