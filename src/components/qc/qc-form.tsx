"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addQcTechnician, discardQcUpload, lookupQcWip, prepareQcUpload, retestQc, submitQc, type QcFormOptions, type QcWipInfo } from "@/app/actions/qc";
import { QC_MAX_FILES, QC_PURPOSE_GROUPS, QC_REPAIR_TYPES, QC_TEST_DRIVE_KIND_LABEL, type QcTechnician } from "@/lib/qc/constants";
import { fmtBytes, uploadToSession } from "@/components/tech-claims/upload";

// Built for a phone first: one column, big tap targets, 16px text in fields (a smaller size makes iPhones zoom in), and
// the Submit button always in reach at the bottom of the screen.

const field =
  "w-full rounded-xl border border-neutral-300 bg-white px-3.5 py-3 text-base shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none sm:text-sm disabled:bg-neutral-100";

type Upload = { key: string; name: string; size: number; sent: number; driveId?: string; error?: string };

function Field({ title, children, hint }: { title: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-semibold text-neutral-800">{title}</div>
      {children}
      {hint && <div className="text-xs text-neutral-500">{hint}</div>}
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70 sm:p-5">
      <h2 className="flex items-center gap-2.5 text-base font-bold text-neutral-900">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-sm text-white">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A row of big buttons to pick one value (no small radio circles or dropdowns on a phone). */
function Choice<T extends string>({ options, value, onChange, cols = 2 }: { options: { key: T; label: string }[]; value: T | ""; onChange: (v: T) => void; cols?: 1 | 2 | 3 }) {
  return (
    <div className={`grid gap-2 ${cols === 3 ? "grid-cols-1 sm:grid-cols-3" : cols === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className={`min-h-12 rounded-xl px-3 py-2.5 text-sm font-semibold ring-1 transition active:scale-[0.98] ${
            value === o.key ? "bg-brand text-white ring-brand" : "bg-white text-neutral-800 ring-neutral-300 hover:bg-neutral-50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const numberOnly = (s: string) => s.replace(/[^\d]/g, "");

/** The technicians who did the work: the branch's technicians, plus names typed in (kept for next time). */
function TechnicianPicker({ options, value, onChange }: { options: QcTechnician[]; value: QcTechnician[]; onChange: (v: QcTechnician[]) => void }) {
  const [list, setList] = useState(options);
  const [typing, setTyping] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const free = list.filter((t) => !value.some((v) => v.name === t.name));

  async function addNew() {
    setError(null);
    const r = await addQcTechnician(name);
    if (r.error || !r.technician) return setError(r.error ?? "Could not add the technician.");
    const t = r.technician;
    if (!list.some((x) => x.name === t.name)) setList([...list, t]);
    if (!value.some((x) => x.name === t.name)) onChange([...value, t]);
    setName("");
    setTyping(false);
  }

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((t) => (
            <span key={t.name} className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 py-1.5 pr-1.5 pl-3 text-sm font-medium text-brand">
              {t.name}
              <button type="button" onClick={() => onChange(value.filter((v) => v.name !== t.name))} aria-label={`Remove ${t.name}`} className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-brand/15">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <select
        value=""
        onChange={(e) => {
          const t = free.find((x) => x.name === e.target.value);
          if (t) onChange([...value, t]);
        }}
        className={field}
      >
        <option value="">{value.length ? "+ Add another technician" : "Choose the technician"}</option>
        {free.map((t) => (
          <option key={t.name} value={t.name}>
            {t.name}
          </option>
        ))}
      </select>
      {typing ? (
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Technician’s name" className={field} autoFocus />
          <button type="button" onClick={addNew} className="rounded-xl bg-brand px-4 text-sm font-semibold text-white">
            Add
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setTyping(true)} className="text-sm font-semibold text-brand">
          + Technician not in the list
        </button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

/** Pass / Fail, the final odometer (always), and the justification (fail) or comment (pass). */
function ResultFields({
  result,
  setResult,
  comment,
  setComment,
  finalOdometer,
  setFinalOdometer,
}: {
  result: "pass" | "fail" | "";
  setResult: (r: "pass" | "fail") => void;
  comment: string;
  setComment: (s: string) => void;
  finalOdometer: string;
  setFinalOdometer: (s: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {(["pass", "fail"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setResult(r)}
            aria-pressed={result === r}
            className={`min-h-16 rounded-2xl text-lg font-bold ring-2 transition active:scale-[0.98] ${
              result === r ? (r === "pass" ? "bg-emerald-600 text-white ring-emerald-600" : "bg-red-600 text-white ring-red-600") : "bg-white text-neutral-700 ring-neutral-300"
            }`}
          >
            {r === "pass" ? "✓ Pass" : "✕ Fail"}
          </button>
        ))}
      </div>
      <Field title="Final odometer *">
        <input value={finalOdometer} onChange={(e) => setFinalOdometer(numberOnly(e.target.value))} inputMode="numeric" className={field} placeholder="km" />
      </Field>
      {result && (
        <Field title={result === "fail" ? "Justification (why it failed) *" : "Comment (optional)"}>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} className={field} placeholder={result === "fail" ? "What the workshop must fix" : ""} />
        </Field>
      )}
    </div>
  );
}

/** Files go to Google Drive the moment they are added (into the WIP's QC folder). */
function useUploads(target: () => { wip?: string; checkId?: string } | null) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const patch = (key: string, p: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...p } : x)));

  async function add(files: FileList | null) {
    setError(null);
    if (!files?.length) return;
    const t = target();
    if (!t) return setError("Enter the WIP number before attaching files.");
    const room = QC_MAX_FILES - uploads.length;
    const list = [...files].slice(0, Math.max(0, room));
    if (files.length > list.length) setError(`Up to ${QC_MAX_FILES} files.`);
    const items = list.map((f) => ({ file: f, key: `u${++seq.current}` }));
    setUploads((u) => [...u, ...items.map(({ file, key }) => ({ key, name: file.name, size: file.size, sent: 0 }))]);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const { file, key } = items[next++];
        try {
          const r = await prepareQcUpload(t, { name: file.name, type: file.type || "application/octet-stream", size: file.size });
          if (!r.session) throw new Error(r.error ?? "Could not start the upload.");
          const id = await uploadToSession(r.session, file, (sent) => patch(key, { sent }));
          patch(key, { driveId: id, sent: file.size });
        } catch (e) {
          patch(key, { error: e instanceof Error ? e.message : "Upload failed." });
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  function remove(key: string) {
    const u = uploads.find((x) => x.key === key);
    setUploads((list) => list.filter((x) => x.key !== key));
    const t = target();
    if (u?.driveId && t) void discardQcUpload(t, u.driveId);
  }

  const busy = uploads.some((u) => !u.driveId && !u.error);
  const ids = uploads.filter((u) => u.driveId).map((u) => u.driveId!);
  return { uploads, add, remove, busy, ids, error };
}

/** Take a photo / video with the camera, or pick files (photos, videos, PDF). */
function FilesField({ files, onBeforeAdd }: { files: ReturnType<typeof useUploads>; onBeforeAdd?: () => void }) {
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const add = (l: FileList | null) => {
    onBeforeAdd?.();
    void files.add(l);
  };
  return (
    <div className="space-y-3">
      <input ref={camera} type="file" accept="image/*,video/*" capture="environment" className="hidden" onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
      <input ref={picker} type="file" multiple accept="image/*,video/*,application/pdf" className="hidden" onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => camera.current?.click()} className="min-h-12 rounded-xl border border-neutral-300 bg-white px-3 text-sm font-semibold text-neutral-800 active:bg-neutral-50">
          📷 Camera
        </button>
        <button type="button" onClick={() => picker.current?.click()} className="min-h-12 rounded-xl border border-neutral-300 bg-white px-3 text-sm font-semibold text-neutral-800 active:bg-neutral-50">
          📎 Choose files
        </button>
      </div>
      <p className="text-xs text-neutral-500">Photos, videos or PDF - for your reference.</p>
      {files.error && <p className="text-sm text-red-600">{files.error}</p>}
      {files.uploads.length > 0 && (
        <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white text-sm">
          {files.uploads.map((u) => (
            <li key={u.key} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate">{u.name}</div>
                {u.error ? (
                  <div className="text-xs text-red-600">{u.error}</div>
                ) : u.driveId ? (
                  <div className="text-xs text-emerald-700">Uploaded · {fmtBytes(u.size)}</div>
                ) : (
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                    <div className="h-full bg-brand transition-all" style={{ width: `${Math.round((u.sent / Math.max(1, u.size)) * 100)}%` }} />
                  </div>
                )}
              </div>
              <button type="button" onClick={() => files.remove(u.key)} className="px-2 py-1 text-xs text-neutral-500 hover:text-red-600">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The Submit button, kept at the bottom of the screen on a phone. */
function SubmitBar({ label, busy, saving, error }: { label: string; busy: boolean; saving: boolean; error: string | null }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 space-y-2 border-t border-neutral-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0">
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{error}</p>}
      <button disabled={saving || busy} className="min-h-13 w-full rounded-2xl bg-brand px-4 py-3.5 text-base font-bold text-white shadow-sm active:scale-[0.99] disabled:opacity-50">
        {busy ? "Uploading files…" : saving ? "Saving…" : label}
      </button>
    </div>
  );
}

/** Quality controller: a new QC for one vehicle (WIP). */
export function QcNewForm({ options }: { options: QcFormOptions }) {
  const router = useRouter();
  const [wip, setWip] = useState("");
  const [info, setInfo] = useState<QcWipInfo | null>(null);
  const [odometerIn, setOdometerIn] = useState("");
  const [group, setGroup] = useState<string>("");
  const [kind, setKind] = useState<string>("");
  const [technicians, setTechnicians] = useState<QcTechnician[]>([]);
  const [teamLeader, setTeamLeader] = useState("");
  const [serviceAdvisor, setServiceAdvisor] = useState("");
  const [model, setModel] = useState("");
  const [repairType, setRepairType] = useState("");
  const [replacedParts, setReplacedParts] = useState("");
  const [defectDescription, setDefectDescription] = useState("");
  const [result, setResult] = useState<"pass" | "fail" | "">("");
  const [comment, setComment] = useState("");
  const [finalOdometer, setFinalOdometer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const wipLocked = useRef<string | null>(null);
  const files = useUploads(() => (wip.replace(/\D/g, "") ? { wip: wipLocked.current ?? wip } : null));
  const testDrive = QC_PURPOSE_GROUPS.find((g) => g.key === "test_drive")!;
  const purpose = group === "test_drive" ? kind : group;

  async function lookup() {
    if (!wip.replace(/\D/g, "")) return setInfo(null);
    const r = await lookupQcWip(wip);
    if (!r.info) return;
    setInfo(r.info);
    if (r.info.mileage && !odometerIn) setOdometerIn(String(r.info.mileage));
    if (r.info.advisor && !serviceAdvisor) setServiceAdvisor(r.info.advisor);
    if (r.info.modelName && !model && options.models.includes(r.info.modelName)) setModel(r.info.modelName);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (group === "test_drive" && !kind) return setError("Choose the kind of test drive.");
    if (!result) return setError("Choose Pass or Fail.");
    setSaving(true);
    const r = await submitQc({ wip: (files.uploads.length && wipLocked.current) || wip, odometerIn, purpose, model, teamLeader, serviceAdvisor, replacedParts, defectDescription, repairType, result, comment, finalOdometer, technicians, driveFileIds: files.ids });
    setSaving(false);
    if (r.error) return setError(r.error);
    if (r.id) router.push(`/qc/${r.id}`);
  }

  const wipChangeBlocked = files.uploads.length > 0;
  return (
    <form onSubmit={submit} className="space-y-4">
      <Section n={1} title="Vehicle">
        <Field
          title="WIP number *"
          hint={wipChangeBlocked ? "Files are attached to this WIP - remove them to change it." : options.branchCode ? `Numbers only - saved as ${options.branchCode}-…` : undefined}
        >
          <div className="flex gap-2">
            <input value={wip} disabled={wipChangeBlocked} onChange={(e) => setWip(e.target.value)} onBlur={lookup} inputMode="numeric" enterKeyHint="next" className={field} placeholder="e.g. 12345" />
            <button type="button" onClick={lookup} disabled={wipChangeBlocked} className="shrink-0 rounded-xl border border-neutral-300 bg-white px-4 text-sm font-semibold text-neutral-700 disabled:opacity-50">
              Find
            </button>
          </div>
        </Field>
        {info?.model && (
          <p className="rounded-xl bg-neutral-50 px-3 py-2 text-sm text-neutral-700 ring-1 ring-neutral-200">
            Open WIPs: <b>{info.model}</b>
            {info.registration ? ` · ${info.registration}` : ""}
          </p>
        )}
        {info && info.earlier.length > 0 && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
            This WIP already has a QC:{" "}
            {info.earlier.map((e, i) => (
              <span key={e.id}>
                {i > 0 && ", "}
                <Link href={`/qc/${e.id}`} className="font-semibold underline">
                  {e.qcNo}
                </Link>{" "}
                ({e.status === "failed" ? "failed - test it again there" : "passed"})
              </span>
            ))}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field title="Odometer IN *">
            <input value={odometerIn} onChange={(e) => setOdometerIn(numberOnly(e.target.value))} inputMode="numeric" className={field} placeholder="km" />
          </Field>
          <Field title="Vehicle model *">
            <select value={model} onChange={(e) => setModel(e.target.value)} className={field}>
              <option value="">Choose</option>
              {options.models.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section n={2} title="Purpose of the QC test">
        <Choice
          options={QC_PURPOSE_GROUPS.map((g) => ({ key: g.key as string, label: g.label }))}
          value={group}
          onChange={(g) => {
            setGroup(g);
            if (g !== "test_drive") setKind("");
          }}
        />
        {group === "test_drive" && (
          <div className="space-y-2 rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-200">
            <div className="text-sm font-semibold text-neutral-800">Which test drive? *</div>
            <Choice options={testDrive.kinds.map((k) => ({ key: k as string, label: QC_TEST_DRIVE_KIND_LABEL[k] }))} value={kind} onChange={setKind} cols={3} />
          </div>
        )}
      </Section>

      <Section n={3} title="People">
        <Field title="Technician(s) *">
          <TechnicianPicker options={options.technicians} value={technicians} onChange={setTechnicians} />
        </Field>
        <Field title="Team leader *">
          <Choice options={options.teamLeaders.map((n) => ({ key: n, label: n }))} value={teamLeader} onChange={setTeamLeader} />
        </Field>
        <Field title="Service advisor *">
          <Choice options={options.advisors.map((n) => ({ key: n, label: n }))} value={serviceAdvisor} onChange={setServiceAdvisor} />
        </Field>
      </Section>

      <Section n={4} title="Repair">
        <Field title="Repair type *">
          <Choice options={QC_REPAIR_TYPES.map((r) => ({ key: r.key as string, label: r.label }))} value={repairType} onChange={setRepairType} cols={3} />
        </Field>
        <Field title="Replaced parts">
          <textarea value={replacedParts} onChange={(e) => setReplacedParts(e.target.value)} rows={3} className={field} placeholder="Part numbers / names" />
        </Field>
        <Field title="Defect description (of the replaced parts)">
          <textarea value={defectDescription} onChange={(e) => setDefectDescription(e.target.value)} rows={3} className={field} />
        </Field>
      </Section>

      <Section n={5} title="Result">
        <ResultFields result={result} setResult={setResult} comment={comment} setComment={setComment} finalOdometer={finalOdometer} setFinalOdometer={setFinalOdometer} />
      </Section>

      <Section n={6} title="Files">
        <FilesField files={files} onBeforeAdd={() => (wipLocked.current = wip)} />
      </Section>

      <SubmitBar label="Submit QC" busy={files.busy} saving={saving} error={error} />
    </form>
  );
}

/** Quality controller: test a failed vehicle again - the technicians may have changed (the workshop assigned another). */
export function QcRetestForm({ checkId, options, lastTechnicians }: { checkId: string; options: QcFormOptions; lastTechnicians: QcTechnician[] }) {
  const router = useRouter();
  const [technicians, setTechnicians] = useState<QcTechnician[]>(lastTechnicians);
  const [result, setResult] = useState<"pass" | "fail" | "">("");
  const [comment, setComment] = useState("");
  const [finalOdometer, setFinalOdometer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const files = useUploads(() => ({ checkId }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!result) return setError("Choose Pass or Fail.");
    setSaving(true);
    const r = await retestQc(checkId, { result, comment, finalOdometer, technicians, driveFileIds: files.ids });
    setSaving(false);
    if (r.error) return setError(r.error);
    setResult("");
    setComment("");
    setFinalOdometer("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Section n={1} title="Test again">
        <Field title="Technician(s) who did the rework *" hint="Change it if the workshop gave the job to another technician.">
          <TechnicianPicker options={options.technicians} value={technicians} onChange={setTechnicians} />
        </Field>
      </Section>
      <Section n={2} title="Result">
        <ResultFields result={result} setResult={setResult} comment={comment} setComment={setComment} finalOdometer={finalOdometer} setFinalOdometer={setFinalOdometer} />
      </Section>
      <Section n={3} title="Files">
        <FilesField files={files} />
      </Section>
      <SubmitBar label="Save the test" busy={files.busy} saving={saving} error={error} />
    </form>
  );
}
