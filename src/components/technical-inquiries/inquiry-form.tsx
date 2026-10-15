"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createTechnicalInquiry, findSimilarInquiries, type InquiryAttachmentInput, type SimilarInquiry } from "@/app/actions/technical-inquiries";
import { normalizeWorkOrder } from "@/lib/rejected-claims";
import {
  AFTER_REPAIR_LABEL,
  INQUIRY_FIRST_NOTICED_MAX,
  INQUIRY_MAX_MILEAGE,
  INQUIRY_MAX_STEPS,
  INQUIRY_MAX_WORK_ORDERS,
  INQUIRY_MODEL_MAX,
  INQUIRY_PERSON_MAX,
  INQUIRY_PLATE_MAX,
  INQUIRY_SHORT_TEXT_MAX,
  INQUIRY_STEP_MAX,
  INQUIRY_TEXT_MAX,
  LOW_MILEAGE_LIMIT_KM,
  OCCURRENCE_CONDITIONS,
  OCCURRENCE_LABEL,
  RESPONSIBLE_ROLE_LABEL,
  STATUS_LABEL,
  SUBMIT_REASONS,
  SUBMIT_REASON_LABEL,
  SYSTEMS,
  SYSTEM_LABEL,
  VEHICLE_LOCATION_LABEL,
  VIN_PATTERN,
  inquiryLabel,
  type AttachmentCategory,
  type InquiryStatus,
} from "@/lib/technical-inquiries";
import { FileBox, uploadPicked, type PickedFile } from "./file-box";

type BranchOption = { id: string; name: string; code: string };

type StepState = { key: string; text: string; files: PickedFile[] };
/** One work order of the case: the first is the current one, the others are previous work orders of the same problem. */
type WipState = { key: string; workOrder: string; previousConcern: string; steps: StepState[]; vds: PickedFile[]; woPhotos: PickedFile[]; agreementPhotos: PickedFile[] };

const newStep = (): StepState => ({ key: crypto.randomUUID(), text: "", files: [] });
const newWip = (): WipState => ({ key: crypto.randomUUID(), workOrder: "", previousConcern: "", steps: [newStep()], vds: [], woPhotos: [], agreementPhotos: [] });

const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm transition-colors placeholder:text-neutral-500 focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none disabled:opacity-60";

/**
 * "New technical inquiry": a collapsed bar. Clicking it first asks which of the conditions for sending a case to the
 * technical team is met (a pop-up; at least one must be ticked), then opens the technical request form. A branch admin
 * always submits for their own branch (it is not asked); an officer picks the branch. The form asks for what the technical
 * team needs to validate a case: who is escalating, the vehicle data and whether the car is still in the workshop, the work
 * order and any previous work orders of the same problem, the customer concern (and the previous concern of each earlier
 * visit) with media, when it happens, when it first appeared and whether it follows a repair, the vehicle history, and for
 * every work order the workshop effort step by step with the VDS report, the work order photo and the agreement photo.
 */
export function InquiryForm({
  branches,
  fixedBranchId,
  basePath,
  driveReady,
}: {
  branches: BranchOption[];
  /** Set for a branch admin: the only branch they can submit for. */
  fixedBranchId?: string;
  basePath: string;
  driveReady: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [inquiryId] = useState(() => crypto.randomUUID());
  const [branchId, setBranchId] = useState(fixedBranchId ?? "");
  const [responsibleName, setResponsibleName] = useState("");
  const [responsibleRole, setResponsibleRole] = useState("");
  const [responsiblePhone, setResponsiblePhone] = useState("");
  const [vehicleLocation, setVehicleLocation] = useState("");
  const [wips, setWips] = useState<WipState[]>(() => [newWip()]);
  const [vin, setVin] = useState("");
  const [plate, setPlate] = useState("");
  const [mileage, setMileage] = useState("");
  const [model, setModel] = useState("");
  const [system, setSystem] = useState("");
  const [fault, setFault] = useState("");
  const [concernFiles, setConcernFiles] = useState<PickedFile[]>([]);
  const [occurrence, setOccurrence] = useState("");
  const [conditionKeys, setConditionKeys] = useState<string[]>([]);
  const [otherCondition, setOtherCondition] = useState("");
  const [firstNoticed, setFirstNoticed] = useState("");
  const [afterRepair, setAfterRepair] = useState("");
  const [repairDetails, setRepairDetails] = useState("");
  const [historyFiles, setHistoryFiles] = useState<PickedFile[]>([]);
  const [comments, setComments] = useState("");
  const [similarFor, setSimilarFor] = useState<{ vin: string; cases: SimilarInquiry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const branch = branches.find((b) => b.id === (fixedBranchId ?? branchId));
  const vinClean = vin.trim().toUpperCase().replace(/\s+/g, "");
  const vinOk = VIN_PATTERN.test(vinClean);
  const woPreview = (value: string) => (branch && value.trim() ? normalizeWorkOrder(value, branch.code) : null);

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

  const patchWip = (index: number, patch: Partial<WipState>) => setWips((cur) => cur.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  const patchStep = (wipIndex: number, stepIndex: number, patch: Partial<StepState>) =>
    setWips((cur) => cur.map((w, i) => (i === wipIndex ? { ...w, steps: w.steps.map((st, j) => (j === stepIndex ? { ...st, ...patch } : st)) } : w)));
  function moveStep(wipIndex: number, stepIndex: number, by: -1 | 1) {
    setWips((cur) =>
      cur.map((w, i) => {
        if (i !== wipIndex) return w;
        const target = stepIndex + by;
        if (target < 0 || target >= w.steps.length) return w;
        const steps = [...w.steps];
        [steps[stepIndex], steps[target]] = [steps[target], steps[stepIndex]];
        return { ...w, steps };
      })
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    if (reasons.length === 0) return setError("Tick at least one of the conditions for sending a case to the technical team.");
    if (!branch) return setError("Choose the branch.");
    if (responsibleName.trim().length < 2) return setError("Enter the name of the workshop supervisor or delegated responsible.");
    if (!responsibleRole) return setError("Say whether the case is escalated by the workshop supervisor or a delegated responsible.");
    if (!vehicleLocation) return setError("Say whether the car is in the workshop or out.");
    const woValues: string[] = [];
    for (const [i, w] of wips.entries()) {
      const p = woPreview(w.workOrder);
      const name = i === 0 ? "work order" : `previous work order ${i}`;
      if (!p || p.value === undefined) return setError(p?.error ?? `Enter the ${name} number.`);
      if (woValues.includes(p.value)) return setError(`The work order ${p.value} is listed twice.`);
      woValues.push(p.value);
    }
    if (!vinOk) return setError("The VIN must be 17 letters and digits (no I, O or Q).");
    if (plate.trim().length < 2) return setError("Enter the plate number.");
    const mileageNumber = mileage.trim() === "" ? null : Number(mileage);
    if (mileageNumber === null || !Number.isInteger(mileageNumber) || mileageNumber < 0 || mileageNumber > INQUIRY_MAX_MILEAGE) return setError("Enter the mileage as a whole number of kilometres.");
    if (reasons.includes("low_mileage") && mileageNumber >= LOW_MILEAGE_LIMIT_KM) return setError("You ticked the low mileage condition, but the mileage is not below 1,000 km. Change the mileage or the ticked conditions.");
    if (!model.trim()) return setError("Enter the vehicle model.");
    if (!system) return setError("Choose the vehicle system the fault is in.");
    if (!fault.trim()) return setError("Describe the customer concern.");
    if (concernFiles.length === 0) return setError("Attach a photo or video that shows the customer concern.");
    for (const [i, w] of wips.entries()) {
      if (i > 0 && !w.previousConcern.trim()) return setError(`Write the customer previous concern of work order ${woValues[i]}.`);
    }
    if (!occurrence) return setError("Say whether the concern is permanent or intermittent.");
    if (conditionKeys.length === 0) return setError(`Tick when the concern happens ${occurrence === "permanent" ? "permanently" : "intermittently"}.`);
    if (conditionKeys.includes("other") && !otherCondition.trim()) return setError("Describe the other condition in which the concern happens.");
    if (!firstNoticed.trim()) return setError("Say when the customer first noticed the concern.");
    if (!afterRepair) return setError("Say whether the concern is related to a previous repair.");
    if (afterRepair === "yes" && !repairDetails.trim()) return setError("Say which previous repair it follows (what was repaired, when, work order).");
    if (historyFiles.length === 0) return setError("Attach the full vehicle history (service / repair history).");
    for (const [i, w] of wips.entries()) {
      const label = `work order ${woValues[i]}`;
      if (w.steps.some((st) => !st.text.trim())) return setError(`Write the workshop effort of ${label}: every step needs its text (remove the empty ones).`);
      if (w.vds.length === 0) return setError(`Attach the VDS report of ${label}.`);
      if (w.woPhotos.length === 0) return setError(`Attach a photo of ${label}.`);
      if (w.agreementPhotos.length === 0) return setError(`Attach a photo of the agreement of ${label}.`);
    }

    setSaving(true);
    try {
      // Everything that is not in Drive yet goes up in one go; each file that lands is remembered, in this variable for the
      // payload below and in the form's state so a failed save never repeats it.
      const landed = new Map<string, string>();
      const pending: PickedFile[] = [
        ...concernFiles,
        ...historyFiles,
        ...wips.flatMap((w) => [...w.steps.flatMap((st) => st.files), ...w.vds, ...w.woPhotos, ...w.agreementPhotos]),
      ].filter((f) => !f.driveFileId);
      const remember = (key: string, driveFileId: string) => {
        landed.set(key, driveFileId);
        const mark = (files: PickedFile[]) => files.map((f) => (f.key === key ? { ...f, driveFileId } : f));
        setConcernFiles(mark);
        setHistoryFiles(mark);
        setWips((cur) => cur.map((w) => ({ ...w, steps: w.steps.map((st) => ({ ...st, files: mark(st.files) })), vds: mark(w.vds), woPhotos: mark(w.woPhotos), agreementPhotos: mark(w.agreementPhotos) })));
      };
      if (pending.length > 0) await uploadPicked(pending, { inquiryId, branchId: branch.id, workOrder: woValues[0] }, remember, setStatus);

      const input = (f: PickedFile, category?: AttachmentCategory): InquiryAttachmentInput => ({
        driveFileId: (f.driveFileId ?? landed.get(f.key))!,
        name: f.file.name,
        type: f.file.type,
        size: f.file.size,
        category,
      });
      const result = await createTechnicalInquiry({
        id: inquiryId,
        branchId: branch.id,
        vin: vinClean,
        plate,
        model,
        system,
        vehicleLocation,
        mileage: mileageNumber,
        occurrence,
        conditionKeys,
        conditions: conditionKeys.includes("other") ? otherCondition : "",
        responsibleName,
        responsibleRole,
        responsiblePhone,
        firstNoticed,
        afterRepair,
        repairDetails: afterRepair === "yes" ? repairDetails : "",
        fault,
        comments,
        reasons,
        workOrders: wips.map((w, i) => ({
          workOrder: woValues[i],
          previousConcern: i > 0 ? w.previousConcern : undefined,
          steps: w.steps.map((st) => ({ text: st.text, files: st.files.map((f) => input(f)) })),
          vds: w.vds.map((f) => input(f)),
          woPhotos: w.woPhotos.map((f) => input(f)),
          agreementPhotos: w.agreementPhotos.map((f) => input(f)),
        })),
        attachments: [...concernFiles.map((f) => input(f, "concern_media")), ...historyFiles.map((f) => input(f, "vehicle_history"))],
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
      setStatus(null);
    }
  }

  const fileBoxProps = { disabled: saving, driveReady, onError: setError };

  return (
    <section className="rounded-xl border border-neutral-200/70 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : setAsking(true))}
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

      {open && (
        <form onSubmit={handleSave} className="space-y-7 border-t border-neutral-100 p-4">
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            <span className="font-semibold">Sent because:</span>
            {reasons.map((r) => (
              <span key={r} className="rounded-full bg-white px-2.5 py-0.5 font-medium ring-1 ring-emerald-200 ring-inset">
                {SUBMIT_REASON_LABEL[r] ?? r}
              </span>
            ))}
            <button type="button" onClick={() => setAsking(true)} disabled={saving} className="ml-auto font-semibold underline">
              Change
            </button>
          </div>

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
              <Choice legend="Where is the car?" name="ti-location" value={vehicleLocation} onChange={setVehicleLocation} disabled={saving} options={Object.entries(VEHICLE_LOCATION_LABEL)} />
            </div>
          </Section>

          <Section number={2} title="Vehicle data">
            <div className="grid gap-4 sm:grid-cols-2">
              {fixedBranchId ? null : (
                <div className="space-y-1.5">
                  <label htmlFor="ti-branch" className="text-xs font-medium text-neutral-700">
                    Branch
                  </label>
                  <select id="ti-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={saving} className={inputClass}>
                    <option value="">Choose a branch</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1.5">
                <label htmlFor="ti-wo-0" className="text-xs font-medium text-neutral-700">
                  Work order (WIP) number
                </label>
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-[10rem] flex-1">
                    <input
                      id="ti-wo-0"
                      value={wips[0].workOrder}
                      onChange={(e) => patchWip(0, { workOrder: e.target.value })}
                      placeholder={branch ? `35698 or ${branch.code}-35698` : "35698"}
                      maxLength={40}
                      disabled={saving}
                      className={inputClass}
                    />
                    <WoNote preview={woPreview(wips[0].workOrder)} />
                  </div>
                  <button
                    type="button"
                    onClick={() => setWips((cur) => [...cur, newWip()])}
                    disabled={saving || wips.length >= INQUIRY_MAX_WORK_ORDERS}
                    title="Add a previous work order of the same problem"
                    className="flex h-[38px] shrink-0 items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/5 px-3 text-sm font-semibold text-brand shadow-sm transition-colors hover:bg-brand/10 disabled:opacity-50"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-base leading-none text-white">+</span>
                    Add previous Work Order
                  </button>
                </div>
              </div>
              {wips.slice(1).map((w, k) => (
                <div key={w.key} className="space-y-1.5 sm:col-span-2 sm:max-w-[calc(50%-0.5rem)] sm:justify-self-end">
                  <label htmlFor={`ti-wo-${k + 1}`} className="text-xs font-medium text-neutral-700">
                    Previous work order {k + 1}
                  </label>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <input id={`ti-wo-${k + 1}`} value={w.workOrder} onChange={(e) => patchWip(k + 1, { workOrder: e.target.value })} placeholder={branch ? `${branch.code}-35000` : "35000"} maxLength={40} disabled={saving} className={inputClass} />
                      <WoNote preview={woPreview(w.workOrder)} />
                    </div>
                    <button
                      type="button"
                      onClick={() => setWips((cur) => cur.filter((x) => x.key !== w.key))}
                      disabled={saving}
                      aria-label={`Remove previous work order ${k + 1}`}
                      className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border border-neutral-300 bg-white text-lg text-neutral-600 shadow-sm transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
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
              <FileBox {...fileBoxProps} files={concernFiles} onChange={setConcernFiles} label="Add photos or videos of the concern" />
            </div>
            {wips.slice(1).map((w, k) => (
              <TextArea
                key={w.key}
                id={`ti-prev-concern-${k + 1}`}
                label={`Customer previous concern${w.workOrder.trim() ? ` - work order ${woPreview(w.workOrder)?.value ?? w.workOrder.trim().toUpperCase()}` : ` - previous work order ${k + 1}`}`}
                value={w.previousConcern}
                onChange={(v) => patchWip(k + 1, { previousConcern: v })}
                disabled={saving}
                rows={3}
                placeholder="What did the customer complain about at that earlier visit?"
              />
            ))}
          </Section>

          <Section number={4} title="How the concern happens">
            <Choice
              legend="The concern is"
              name="ti-occurrence"
              value={occurrence}
              onChange={(v) => {
                setOccurrence(v);
                setConditionKeys([]);
                setOtherCondition("");
              }}
              disabled={saving}
              options={Object.entries(OCCURRENCE_LABEL)}
            />
            {occurrence && (
              <fieldset className="space-y-2" disabled={saving}>
                <legend className="text-xs font-medium text-neutral-700">It happens {occurrence === "permanent" ? "permanently" : "intermittently"} when:</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {OCCURRENCE_CONDITIONS.map((c) => (
                    <label key={c.key} className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm ${conditionKeys.includes(c.key) ? "border-brand bg-brand/5 text-neutral-900" : "border-neutral-300 bg-white text-neutral-700"}`}>
                      <input
                        type="checkbox"
                        checked={conditionKeys.includes(c.key)}
                        onChange={(e) => setConditionKeys((cur) => (e.target.checked ? [...cur, c.key] : cur.filter((k) => k !== c.key)))}
                        className="h-4 w-4 shrink-0 rounded border-neutral-300 text-brand focus:ring-brand/30"
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
                {conditionKeys.includes("other") && (
                  <input value={otherCondition} onChange={(e) => setOtherCondition(e.target.value)} maxLength={INQUIRY_SHORT_TEXT_MAX} aria-label="The other condition" placeholder="Describe the other condition" className={inputClass} />
                )}
              </fieldset>
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
              <FileBox {...fileBoxProps} files={historyFiles} onChange={setHistoryFiles} label="Add the vehicle history" />
            </div>
          </Section>

          <Section number={6} title="Workshop effort" hint="For every work order: each check, test and repair, written accurately and in the order it was done, with its own photos or videos - then the three documents asked for every work order.">
            {wips.map((w, wi) => {
              const p = woPreview(w.workOrder);
              const title = p?.value ?? (w.workOrder.trim() ? w.workOrder.trim().toUpperCase() : wi === 0 ? "Work order" : `Previous work order ${wi}`);
              return (
                <div key={w.key} className="space-y-4 rounded-xl border border-neutral-200 bg-neutral-50/50 p-3 sm:p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
                    {title}
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-600 ring-1 ring-neutral-200 ring-inset">{wi === 0 ? "current work order" : "previous work order"}</span>
                  </p>
                  <ol className="space-y-3">
                    {w.steps.map((step, si) => (
                      <li key={step.key} className="flex items-start gap-2">
                        <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand">{si + 1}</span>
                        <div className="min-w-0 flex-1 space-y-2">
                          <textarea
                            value={step.text}
                            onChange={(e) => patchStep(wi, si, { text: e.target.value })}
                            maxLength={INQUIRY_STEP_MAX}
                            rows={2}
                            disabled={saving}
                            aria-label={`${title} - step ${si + 1}`}
                            placeholder={si === 0 ? "e.g. Scanned all modules - P0300 stored in the engine control module" : "Next check, test or repair"}
                            className={`${inputClass} resize-y`}
                          />
                          <FileBox {...fileBoxProps} files={step.files} onChange={(files) => patchStep(wi, si, { files })} label="Add attachment" />
                        </div>
                        <div className="flex shrink-0 flex-col gap-1 pt-1">
                          <button type="button" onClick={() => moveStep(wi, si, -1)} disabled={saving || si === 0} aria-label={`Move step ${si + 1} up`} className="h-5 w-6 rounded border border-neutral-300 bg-white text-[10px] leading-none text-neutral-600 hover:bg-neutral-50 disabled:opacity-30">
                            ▲
                          </button>
                          <button type="button" onClick={() => moveStep(wi, si, 1)} disabled={saving || si === w.steps.length - 1} aria-label={`Move step ${si + 1} down`} className="h-5 w-6 rounded border border-neutral-300 bg-white text-[10px] leading-none text-neutral-600 hover:bg-neutral-50 disabled:opacity-30">
                            ▼
                          </button>
                          <button
                            type="button"
                            onClick={() => patchWip(wi, { steps: w.steps.length > 1 ? w.steps.filter((x) => x.key !== step.key) : [newStep()] })}
                            disabled={saving}
                            aria-label={`Remove step ${si + 1}`}
                            className="h-5 w-6 rounded border border-neutral-300 bg-white text-xs leading-none text-neutral-600 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                          >
                            ×
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <button
                    type="button"
                    onClick={() => patchWip(wi, { steps: [...w.steps, newStep()] })}
                    disabled={saving || w.steps.length >= INQUIRY_MAX_STEPS}
                    className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-50"
                  >
                    + Add a step
                  </button>
                  <div className="grid gap-4 border-t border-neutral-200 pt-4 sm:grid-cols-3">
                    <DocBox title="VDS report" hint="Required">
                      <FileBox {...fileBoxProps} files={w.vds} onChange={(files) => patchWip(wi, { vds: files })} label="Add the VDS report" />
                    </DocBox>
                    <DocBox title="Work order photo" hint="Required">
                      <FileBox {...fileBoxProps} files={w.woPhotos} onChange={(files) => patchWip(wi, { woPhotos: files })} label="Add the work order photo" />
                    </DocBox>
                    <DocBox title="Agreement photo" hint="Required">
                      <FileBox {...fileBoxProps} files={w.agreementPhotos} onChange={(files) => patchWip(wi, { agreementPhotos: files })} label="Add the agreement photo" />
                    </DocBox>
                  </div>
                </div>
              );
            })}
          </Section>

          <TextArea id="ti-comments" label="Comments of the workshop" optional value={comments} onChange={setComments} disabled={saving} rows={3} placeholder="Anything else the technical team should know" />

          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-neutral-500">The inquiry gets its number (TI-0001...) once it is submitted.</p>
            <div className="flex shrink-0 items-center gap-3">
              {status && <span className="text-sm text-neutral-500">{status}</span>}
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

      {asking && (
        <ReasonsDialog
          selected={reasons}
          onClose={() => setAsking(false)}
          onContinue={(picked) => {
            setReasons(picked);
            setAsking(false);
            setOpen(true);
          }}
        />
      )}
    </section>
  );
}

function WoNote({ preview }: { preview: { value?: string; error?: string } | null }) {
  if (!preview) return null;
  return (
    <p className={`mt-1 text-xs ${preview.error ? "text-red-600" : "text-neutral-500"}`}>
      {preview.error ?? (
        <>
          Saved as <span className="font-semibold text-neutral-800">{preview.value}</span>
        </>
      )}
    </p>
  );
}

function DocBox({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-neutral-700">
        {title} <span className="font-normal text-neutral-500">({hint})</span>
      </p>
      {children}
    </div>
  );
}

/**
 * The pop-up that opens when "New technical inquiry" is clicked: a case can go to the technical team only when at least
 * one of these conditions is met. Closes with Escape, a click outside or Cancel.
 */
function ReasonsDialog({ selected, onClose, onContinue }: { selected: string[]; onClose: () => void; onContinue: (picked: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>(selected);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="ti-reasons-title" className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl">
        <div>
          <h2 id="ti-reasons-title" className="text-base font-semibold text-neutral-900">
            Can this case go to the technical team?
          </h2>
          <p className="mt-1 text-sm text-neutral-600">A case can be submitted only when at least one of these conditions is met. Tick the ones that apply.</p>
        </div>
        <ul className="space-y-2">
          {SUBMIT_REASONS.map((r, i) => (
            <li key={r.key}>
              <label className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${picked.includes(r.key) ? "border-brand bg-brand/5 text-neutral-900" : "border-neutral-200 text-neutral-800 hover:bg-neutral-50"}`}>
                <input
                  type="checkbox"
                  autoFocus={i === 0}
                  checked={picked.includes(r.key)}
                  onChange={(e) => setPicked((cur) => (e.target.checked ? [...cur, r.key] : cur.filter((k) => k !== r.key)))}
                  className="h-4 w-4 shrink-0 rounded border-neutral-300 text-brand focus:ring-brand/30"
                />
                <span>{r.label}</span>
              </label>
            </li>
          ))}
        </ul>
        {picked.length === 0 && <p className="text-xs text-neutral-500">None of these conditions is met? Then the case cannot be sent to the technical team.</p>}
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100">
            Cancel
          </button>
          <button
            type="button"
            disabled={picked.length === 0}
            onClick={() => onContinue(picked)}
            className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
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
