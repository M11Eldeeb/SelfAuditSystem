"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createTechnicalInquiry, findSimilarInquiries, prepareInquiryUploads, type InquiryAttachmentInput, type SimilarInquiry } from "@/app/actions/technical-inquiries";
import { normalizeWorkOrder } from "@/lib/rejected-claims";
import {
  AFTER_REPAIR_LABEL,
  INQUIRY_DTC_MAX,
  INQUIRY_FIRST_NOTICED_MAX,
  INQUIRY_MAX_FILES,
  INQUIRY_MAX_FILE_BYTES,
  INQUIRY_MAX_MILEAGE,
  INQUIRY_MAX_STEPS,
  INQUIRY_MODEL_MAX,
  INQUIRY_PERSON_MAX,
  INQUIRY_PLATE_MAX,
  INQUIRY_SHORT_TEXT_MAX,
  INQUIRY_SOFTWARE_MAX,
  INQUIRY_STEP_MAX,
  INQUIRY_TEXT_MAX,
  OCCURRENCE_LABEL,
  RESPONSIBLE_ROLE_LABEL,
  STATUS_LABEL,
  SYSTEMS,
  SYSTEM_LABEL,
  VIN_PATTERN,
  inquiryLabel,
  type AttachmentCategory,
  type InquiryStatus,
} from "@/lib/technical-inquiries";
import { AttachmentPicker, useAttachments, type PrepareUploads } from "@/components/rejected-claims/use-attachments";

type BranchOption = { id: string; name: string; code: string };

const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm transition-colors placeholder:text-neutral-500 focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none disabled:opacity-60";

/**
 * "New technical inquiry": a collapsed bar that opens into the checklist of the terms the workshop must meet first.
 * Only when every term is ticked does the technical request form appear; the confirmation is recorded with the inquiry.
 * The form asks for what the technical team needs to validate a case: who is escalating, the vehicle data, the customer
 * concern with media, the conditions, when it first appeared and whether it follows a previous repair, the vehicle
 * history, and the workshop effort step by step.
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
  const pickerOptions = { prepare: prepareInquiryUploads as unknown as PrepareUploads, maxFiles: INQUIRY_MAX_FILES, maxFileBytes: INQUIRY_MAX_FILE_BYTES };
  const concernFiles = useAttachments(pickerOptions);
  const historyFiles = useAttachments(pickerOptions);
  const effortFiles = useAttachments(pickerOptions);
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState<boolean[]>(() => terms.map(() => false));
  const [confirmed, setConfirmed] = useState(false);
  const [inquiryId] = useState(() => crypto.randomUUID());
  const [branchId, setBranchId] = useState(fixedBranchId ?? "");
  const [responsibleName, setResponsibleName] = useState("");
  const [responsibleRole, setResponsibleRole] = useState("");
  const [responsiblePhone, setResponsiblePhone] = useState("");
  const [workOrder, setWorkOrder] = useState("");
  const [vin, setVin] = useState("");
  const [plate, setPlate] = useState("");
  const [mileage, setMileage] = useState("");
  const [model, setModel] = useState("");
  const [system, setSystem] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [fault, setFault] = useState("");
  const [occurrence, setOccurrence] = useState("");
  const [conditions, setConditions] = useState("");
  const [firstNoticed, setFirstNoticed] = useState("");
  const [afterRepair, setAfterRepair] = useState("");
  const [repairDetails, setRepairDetails] = useState("");
  const [dtc, setDtc] = useState("");
  const [software, setSoftware] = useState("");
  const [partsReplaced, setPartsReplaced] = useState("");
  const [steps, setSteps] = useState<string[]>([""]);
  const [comments, setComments] = useState("");
  const [similarFor, setSimilarFor] = useState<{ vin: string; cases: SimilarInquiry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const branch = branches.find((b) => b.id === (fixedBranchId ?? branchId));
  const preview = branch && workOrder.trim() ? normalizeWorkOrder(workOrder, branch.code) : null;
  const vinClean = vin.trim().toUpperCase().replace(/\s+/g, "");
  const vinOk = VIN_PATTERN.test(vinClean);
  const allTicked = terms.length > 0 && ticked.every(Boolean);
  const needsConditions = occurrence === "intermittent" || occurrence === "specific";

  // Has this vehicle been to the technical team before? Shown as soon as the VIN is complete.
  useEffect(() => {
    if (!vinOk) return;
    let cancelled = false;
    findSimilarInquiries(vinClean).then((r) => {
      if (!cancelled) setSimilarFor({ vin: vinClean, cases: r.cases });
    });
    return () => {
      cancelled = true;
    };
  }, [vinClean, vinOk]);
  const similar = vinOk && similarFor?.vin === vinClean ? similarFor.cases : [];

  function moveStep(index: number, by: -1 | 1) {
    setSteps((cur) => {
      const next = [...cur];
      const target = index + by;
      if (target < 0 || target >= next.length) return cur;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    if (!branch) return setError("Choose the branch.");
    if (responsibleName.trim().length < 2) return setError("Enter the name of the workshop supervisor or delegated responsible.");
    if (!responsibleRole) return setError("Say whether the case is escalated by the workshop supervisor or a delegated responsible.");
    if (!preview || preview.value === undefined) return setError(preview?.error ?? "Enter the work order number.");
    if (!vinOk) return setError("The VIN must be 17 letters and digits (no I, O or Q).");
    if (plate.trim().length < 2) return setError("Enter the plate number.");
    const mileageNumber = mileage.trim() === "" ? null : Number(mileage);
    if (mileageNumber === null || !Number.isInteger(mileageNumber) || mileageNumber < 0 || mileageNumber > INQUIRY_MAX_MILEAGE) return setError("Enter the mileage as a whole number of kilometres.");
    if (!model.trim()) return setError("Enter the vehicle model.");
    if (!system) return setError("Choose the vehicle system the fault is in.");
    if (!fault.trim()) return setError("Describe the customer concern.");
    if (concernFiles.count === 0) return setError("Attach a photo or video that shows the customer concern.");
    if (!occurrence) return setError("Say whether the concern is permanent, intermittent or happens under a specific condition.");
    if (needsConditions && !conditions.trim()) return setError("Describe the conditions in which the concern happens.");
    if (!firstNoticed.trim()) return setError("Say when the customer first noticed the concern.");
    if (!afterRepair) return setError("Say whether the concern is related to a previous repair.");
    if (afterRepair === "yes" && !repairDetails.trim()) return setError("Say which previous repair it follows (what was repaired, when, work order).");
    if (historyFiles.count === 0) return setError("Attach the full vehicle history (service / repair history).");
    if (steps.every((t) => !t.trim())) return setError("Write the workshop effort, step by step.");

    setSaving(true);
    try {
      // One folder, three kinds of files: each upload batch is tagged with what it is.
      const ctx = { inquiryId, branchId: branch.id, workOrder: preview.value };
      const tag = (rows: InquiryAttachmentInput[], category: AttachmentCategory) => rows.map((r) => ({ driveFileId: r.driveFileId, name: r.name, type: r.type, size: r.size, category }));
      const concern = tag(await concernFiles.upload(ctx), "concern_media");
      const history = tag(await historyFiles.upload(ctx), "vehicle_history");
      const effort = tag(await effortFiles.upload(ctx), "workshop_effort");
      const result = await createTechnicalInquiry({
        id: inquiryId,
        branchId: branch.id,
        workOrder: preview.value,
        vin: vinClean,
        plate,
        model,
        system,
        priority: urgent ? "urgent" : "normal",
        mileage: mileageNumber,
        dtc,
        software,
        occurrence,
        conditions: needsConditions ? conditions : "",
        partsReplaced,
        responsibleName,
        responsibleRole,
        responsiblePhone,
        firstNoticed,
        afterRepair,
        repairDetails: afterRepair === "yes" ? repairDetails : "",
        fault,
        steps,
        comments,
        termsConfirmed: true,
        attachments: [...concern, ...history, ...effort],
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
            <p className="text-xs text-neutral-500">Confirm that every point below is done. The technical team can only validate and help with a case that meets all of them.</p>
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
        <form onSubmit={handleSave} className="space-y-7 border-t border-neutral-100 p-4">
          <p className="flex items-center justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <span>All {terms.length} terms confirmed.</span>
            <button type="button" onClick={() => setConfirmed(false)} className="font-semibold underline" disabled={saving}>
              Review the terms
            </button>
          </p>

          <Section number={1} title="Who is escalating this case" hint="The workshop supervisor, or the delegated responsible who has the full picture and will talk to the technical team during the investigation.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="ti-resp-name" className="text-xs font-medium text-neutral-700">
                  Name
                </label>
                <input id="ti-resp-name" value={responsibleName} onChange={(e) => setResponsibleName(e.target.value)} maxLength={INQUIRY_PERSON_MAX} disabled={saving} className={inputClass} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="ti-resp-phone" className="text-xs font-medium text-neutral-700">
                  Phone / extension <span className="font-normal text-neutral-500">(optional)</span>
                </label>
                <input id="ti-resp-phone" value={responsiblePhone} onChange={(e) => setResponsiblePhone(e.target.value)} maxLength={40} disabled={saving} className={inputClass} />
              </div>
              <Choice legend="Role" name="ti-resp-role" value={responsibleRole} onChange={setResponsibleRole} disabled={saving} options={Object.entries(RESPONSIBLE_ROLE_LABEL)} />
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-neutral-700">Priority</span>
                <label className="flex h-[38px] cursor-pointer items-center gap-2.5 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-800 shadow-sm">
                  <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} disabled={saving} className="h-4 w-4 rounded border-neutral-300 text-brand focus:ring-brand/30" />
                  <span>
                    Urgent <span className="text-neutral-500">- the customer is waiting</span>
                  </span>
                </label>
              </div>
            </div>
          </Section>

          <Section number={2} title="Vehicle data">
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
                <label htmlFor="ti-plate" className="text-xs font-medium text-neutral-700">
                  Plate number
                </label>
                <input id="ti-plate" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} maxLength={INQUIRY_PLATE_MAX} disabled={saving} className={inputClass} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="ti-mileage" className="text-xs font-medium text-neutral-700">
                  Mileage (km)
                </label>
                <input id="ti-mileage" value={mileage} onChange={(e) => setMileage(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" maxLength={7} placeholder="e.g. 45200" disabled={saving} className={inputClass} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="ti-model" className="text-xs font-medium text-neutral-700">
                  Vehicle model
                </label>
                <input id="ti-model" value={model} onChange={(e) => setModel(e.target.value)} maxLength={INQUIRY_MODEL_MAX} placeholder="e.g. MG ZS 2024" disabled={saving} className={inputClass} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor="ti-system" className="text-xs font-medium text-neutral-700">
                  Vehicle system the concern is in
                </label>
                <select id="ti-system" value={system} onChange={(e) => setSystem(e.target.value)} disabled={saving} className={inputClass}>
                  <option value="">Choose the system</option>
                  {SYSTEMS.map((k) => (
                    <option key={k} value={k}>
                      {SYSTEM_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {similar.length > 0 && (
              <div role="status" className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                <p className="font-semibold">This vehicle already has {similar.length === 5 ? "5 or more" : similar.length} technical case{similar.length === 1 ? "" : "s"}:</p>
                <ul className="space-y-1">
                  {similar.map((c) => (
                    <li key={c.id} className="text-xs">
                      <Link href={`${basePath}/${c.id}`} target="_blank" className="font-semibold underline">
                        {inquiryLabel(c.no)}
                      </Link>{" "}
                      - {SYSTEM_LABEL[c.system as keyof typeof SYSTEM_LABEL] ?? c.system}, work order {c.workOrder}, {STATUS_LABEL[c.status as InquiryStatus] ?? c.status}
                      {c.resolution ? ` - solution: ${c.resolution.length > 140 ? `${c.resolution.slice(0, 140)}...` : c.resolution}` : ""}
                    </li>
                  ))}
                </ul>
                <p className="text-xs">Check whether the same fault was already solved before you send a new case.</p>
              </div>
            )}
          </Section>

          <Section number={3} title="The customer concern" hint="What the customer complains about, in the customer's own words, with clear photos or videos that show it.">
            <TextArea id="ti-fault" label="Customer concern" value={fault} onChange={setFault} disabled={saving} rows={4} placeholder="What does the customer complain about, and what is the fault?" />
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-neutral-700">Photos / videos of the concern</p>
              <AttachmentPicker state={concernFiles} disabled={saving} driveReady={driveReady} label="Attach photos or videos of the concern" />
            </div>
          </Section>

          <Section number={4} title="Conditions of the concern">
            <Choice legend="How does the concern happen?" name="ti-occurrence" value={occurrence} onChange={setOccurrence} disabled={saving} options={Object.entries(OCCURRENCE_LABEL)} />
            {needsConditions && (
              <TextArea
                id="ti-conditions"
                label={occurrence === "specific" ? "Which condition?" : "When does it happen?"}
                value={conditions}
                onChange={setConditions}
                disabled={saving}
                rows={2}
                placeholder="Cold start, after driving 20 km, only when it rains, with the air conditioning on, in reverse..."
                max={INQUIRY_SHORT_TEXT_MAX}
              />
            )}
          </Section>

          <Section number={5} title="History of the concern">
            <div className="space-y-1.5">
              <label htmlFor="ti-first" className="text-xs font-medium text-neutral-700">
                When did the customer first notice it? <span className="font-normal text-neutral-500">(from the customer interview)</span>
              </label>
              <input id="ti-first" value={firstNoticed} onChange={(e) => setFirstNoticed(e.target.value)} maxLength={INQUIRY_FIRST_NOTICED_MAX} placeholder="e.g. About two weeks ago, right after the last fuel stop" disabled={saving} className={inputClass} />
            </div>
            <Choice legend="Is it related to a previous repair?" name="ti-after-repair" value={afterRepair} onChange={setAfterRepair} disabled={saving} options={Object.entries(AFTER_REPAIR_LABEL)} />
            {afterRepair === "yes" && (
              <TextArea id="ti-repair" label="Which repair?" value={repairDetails} onChange={setRepairDetails} disabled={saving} rows={2} placeholder="What was repaired, when, and the work order number" max={INQUIRY_SHORT_TEXT_MAX} />
            )}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-neutral-700">Full vehicle history (service history or repair history)</p>
              <AttachmentPicker state={historyFiles} disabled={saving} driveReady={driveReady} label="Attach the vehicle history" />
            </div>
          </Section>

          <Section number={6} title="Workshop effort" hint="Every check, test and repair, written accurately and in the order it was done. Add a step for each one.">
            <ol className="space-y-2">
              {steps.map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand">{i + 1}</span>
                  <textarea
                    value={step}
                    onChange={(e) => setSteps((cur) => cur.map((v, j) => (j === i ? e.target.value : v)))}
                    maxLength={INQUIRY_STEP_MAX}
                    rows={2}
                    disabled={saving}
                    aria-label={`Workshop step ${i + 1}`}
                    placeholder={i === 0 ? "e.g. Scanned all modules - P0300 stored in the engine control module" : "Next check, test or repair"}
                    className={`${inputClass} resize-y`}
                  />
                  <div className="flex shrink-0 flex-col gap-1 pt-1">
                    <button type="button" onClick={() => moveStep(i, -1)} disabled={saving || i === 0} aria-label={`Move step ${i + 1} up`} className="h-5 w-6 rounded border border-neutral-300 text-[10px] leading-none text-neutral-600 hover:bg-neutral-50 disabled:opacity-30">
                      ▲
                    </button>
                    <button type="button" onClick={() => moveStep(i, 1)} disabled={saving || i === steps.length - 1} aria-label={`Move step ${i + 1} down`} className="h-5 w-6 rounded border border-neutral-300 text-[10px] leading-none text-neutral-600 hover:bg-neutral-50 disabled:opacity-30">
                      ▼
                    </button>
                    <button type="button" onClick={() => setSteps((cur) => (cur.length > 1 ? cur.filter((_, j) => j !== i) : [""]))} disabled={saving} aria-label={`Remove step ${i + 1}`} className="h-5 w-6 rounded border border-neutral-300 text-xs leading-none text-neutral-600 hover:bg-red-50 hover:text-red-600 disabled:opacity-30">
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={() => setSteps((cur) => [...cur, ""])}
              disabled={saving || steps.length >= INQUIRY_MAX_STEPS}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-50"
            >
              + Add a step
            </button>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-neutral-700">
                Photos / videos of the workshop effort <span className="font-normal text-neutral-500">(recommended)</span>
              </p>
              <AttachmentPicker state={effortFiles} disabled={saving} driveReady={driveReady} label="Attach photos or videos of the work" />
            </div>
          </Section>

          <Section number={7} title="More technical details" hint="Optional, but they save the technical team a question.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="ti-dtc" className="text-xs font-medium text-neutral-700">
                  Fault codes (DTC) <span className="font-normal text-neutral-500">(separate with commas)</span>
                </label>
                <input id="ti-dtc" value={dtc} onChange={(e) => setDtc(e.target.value)} maxLength={INQUIRY_DTC_MAX} placeholder="e.g. P0300, P0171, U0100" disabled={saving} className={`${inputClass} font-mono`} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="ti-software" className="text-xs font-medium text-neutral-700">
                  Software / ECU version
                </label>
                <input id="ti-software" value={software} onChange={(e) => setSoftware(e.target.value)} maxLength={INQUIRY_SOFTWARE_MAX} disabled={saving} className={inputClass} />
              </div>
            </div>
            <TextArea id="ti-parts" label="Parts already replaced" optional value={partsReplaced} onChange={setPartsReplaced} disabled={saving} rows={2} placeholder="Part numbers or names the workshop has already changed for this fault" max={INQUIRY_SHORT_TEXT_MAX} />
            <TextArea id="ti-comments" label="Comments of the workshop" optional value={comments} onChange={setComments} disabled={saving} rows={3} placeholder="Anything else the technical team should know" />
          </Section>

          {[concernFiles.error, historyFiles.error, effortFiles.error].filter(Boolean).map((msg, i) => (
            <p key={i} role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {msg}
            </p>
          ))}
          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-neutral-500">The inquiry gets its number (TI-0001...) once it is submitted.</p>
            <div className="flex shrink-0 items-center gap-3">
              {(concernFiles.status || historyFiles.status || effortFiles.status) && <span className="text-sm text-neutral-500">{concernFiles.status ?? historyFiles.status ?? effortFiles.status}</span>}
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

function Section({ number, title, hint, children }: { number: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="mb-1">
        <span className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-xs font-bold text-white">{number}</span>
          {title}
        </span>
        {hint && <span className="mt-0.5 block text-xs font-normal text-neutral-500">{hint}</span>}
      </legend>
      {children}
    </fieldset>
  );
}

function Choice({ legend, name, value, onChange, disabled, options }: { legend: string; name: string; value: string; onChange: (v: string) => void; disabled: boolean; options: [string, string][] }) {
  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      <legend className="text-xs font-medium text-neutral-700">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([key, label]) => (
          <label key={key} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${value === key ? "border-brand bg-brand/5 text-neutral-900" : "border-neutral-300 bg-white text-neutral-700"}`}>
            <input type="radio" name={name} value={key} checked={value === key} onChange={() => onChange(key)} className="h-4 w-4 border-neutral-300 text-brand focus:ring-brand/30" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
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
  max = INQUIRY_TEXT_MAX,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  rows: number;
  placeholder: string;
  optional?: boolean;
  max?: number;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium text-neutral-700">
        {label} {optional && <span className="font-normal text-neutral-500">(optional)</span>}
      </label>
      <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} maxLength={max} rows={rows} disabled={disabled} placeholder={placeholder} className={`${inputClass} resize-y`} />
    </div>
  );
}
