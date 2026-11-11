"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addQcTechnician, discardQcUpload, lookupQcWip, prepareQcUpload, retestQc, submitQc, type QcFormOptions, type QcWipInfo } from "@/app/actions/qc";
import { QC_MAX_FILES, QC_PURPOSES, QC_REPAIR_TYPES, type QcTechnician } from "@/lib/qc/constants";
import { fmtBytes, uploadToSession } from "@/components/tech-claims/upload";

const input = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none";
const label = "text-xs font-semibold text-neutral-700";

type Upload = { key: string; name: string; size: number; sent: number; driveId?: string; error?: string };

function Field({ title, children, hint }: { title: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className={label}>{title}</div>
      {children}
      {hint && <div className="text-xs text-neutral-500">{hint}</div>}
    </div>
  );
}

/** The technicians who did the work: the branch's technicians, plus names typed in (kept for next time). */
function TechnicianPicker({ options, value, onChange }: { options: QcTechnician[]; value: QcTechnician[]; onChange: (v: QcTechnician[]) => void }) {
  const [list, setList] = useState(options);
  const [typing, setTyping] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const has = (t: QcTechnician) => value.some((v) => v.name === t.name);
  const free = list.filter((t) => !has(t));

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
        <div className="flex flex-wrap gap-1.5">
          {value.map((t) => (
            <span key={t.name} className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand">
              {t.name}
              <button type="button" onClick={() => onChange(value.filter((v) => v.name !== t.name))} aria-label={`Remove ${t.name}`} className="text-brand/70 hover:text-brand">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <select
          value=""
          onChange={(e) => {
            const t = free.find((x) => x.name === e.target.value);
            if (t) onChange([...value, t]);
          }}
          className={`${input} w-auto min-w-56 flex-1`}
        >
          <option value="">{value.length ? "Add another technician…" : "Choose the technician…"}</option>
          {free.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
        {!typing && (
          <button type="button" onClick={() => setTyping(true)} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
            + Not in the list
          </button>
        )}
      </div>
      {typing && (
        <div className="flex flex-wrap gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Technician's name" className={`${input} w-auto flex-1`} />
          <button type="button" onClick={addNew} className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand-dark">
            Add
          </button>
          <button type="button" onClick={() => setTyping(false)} className="rounded-lg px-3 py-2 text-xs text-neutral-600">
            Cancel
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Pass / Fail, the justification or comment, and the final odometer when passed. */
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
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {(["pass", "fail"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setResult(r)}
            className={`rounded-xl px-4 py-3 text-sm font-bold ring-1 transition ${
              result === r ? (r === "pass" ? "bg-emerald-600 text-white ring-emerald-600" : "bg-red-600 text-white ring-red-600") : "bg-white text-neutral-700 ring-neutral-300 hover:bg-neutral-50"
            }`}
          >
            {r === "pass" ? "Pass" : "Fail"}
          </button>
        ))}
      </div>
      {result === "fail" && (
        <Field title="Justification (why it failed) *">
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} className={input} placeholder="What the workshop must fix" />
        </Field>
      )}
      {result === "pass" && (
        <>
          <Field title="Final odometer *">
            <input value={finalOdometer} onChange={(e) => setFinalOdometer(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" className={input} placeholder="km" />
          </Field>
          <Field title="Comment (optional)">
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} className={input} />
          </Field>
        </>
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
    // Three at a time.
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

function FilesField({ files, disabled }: { files: ReturnType<typeof useUploads>; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <input
        ref={ref}
        type="file"
        multiple
        accept="image/*,video/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          void files.add(e.target.files);
          e.target.value = "";
        }}
      />
      <button type="button" disabled={disabled} onClick={() => ref.current?.click()} className="rounded-lg border border-dashed border-neutral-400 bg-white px-4 py-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
        + Attach photos, videos or PDF
      </button>
      {files.error && <p className="text-xs text-red-600">{files.error}</p>}
      {files.uploads.length > 0 && (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white text-sm">
          {files.uploads.map((u) => (
            <li key={u.key} className="flex items-center gap-3 px-3 py-2">
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
              <button type="button" onClick={() => files.remove(u.key)} className="text-xs text-neutral-500 hover:text-red-600">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const card = "space-y-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70 sm:p-5";

/** Quality controller: a new QC for one vehicle (WIP). */
export function QcNewForm({ options }: { options: QcFormOptions }) {
  const router = useRouter();
  const [wip, setWip] = useState("");
  const [info, setInfo] = useState<QcWipInfo | null>(null);
  const [odometerIn, setOdometerIn] = useState("");
  const [purpose, setPurpose] = useState("");
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

  async function lookup() {
    if (!wip.replace(/\D/g, "")) return setInfo(null);
    const r = await lookupQcWip(wip);
    if (!r.info) return;
    setInfo(r.info);
    if (r.info.mileage && !odometerIn) setOdometerIn(String(r.info.mileage));
    if (r.info.advisor && !serviceAdvisor) setServiceAdvisor(r.info.advisor);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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
      <div className={card}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            title="WIP number *"
            hint={
              wipChangeBlocked ? (
                "Files are attached to this WIP - remove them to change it."
              ) : info?.model ? (
                <>Open WIPs: {info.model}{info.registration ? ` · ${info.registration}` : ""}</>
              ) : options.branchCode ? (
                `Numbers only - saved as ${options.branchCode}-…`
              ) : undefined
            }
          >
            <input
              value={wip}
              disabled={wipChangeBlocked}
              onChange={(e) => setWip(e.target.value)}
              onBlur={lookup}
              inputMode="numeric"
              className={input}
              placeholder="e.g. 12345"
            />
          </Field>
          <Field title="Odometer IN *">
            <input value={odometerIn} onChange={(e) => setOdometerIn(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" className={input} placeholder="km" />
          </Field>
        </div>
        {info && info.earlier.length > 0 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
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
            . Record a new one only for a new test purpose.
          </p>
        )}

        <Field title="Purpose of quality control test *">
          <div className="grid gap-2 sm:grid-cols-2">
            {QC_PURPOSES.map((p) => (
              <label key={p.key} className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ${purpose === p.key ? "bg-brand/5 ring-brand" : "ring-neutral-200 hover:bg-neutral-50"}`}>
                <input type="radio" name="purpose" checked={purpose === p.key} onChange={() => setPurpose(p.key)} className="accent-brand" />
                {p.label}
              </label>
            ))}
          </div>
        </Field>
      </div>

      <div className={card}>
        <Field title="Technician(s) *">
          <TechnicianPicker options={options.technicians} value={technicians} onChange={setTechnicians} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field title="Team leader *">
            <select value={teamLeader} onChange={(e) => setTeamLeader(e.target.value)} className={input}>
              <option value="">Choose…</option>
              {options.teamLeaders.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Field>
          <Field title="Service advisor *">
            <select value={serviceAdvisor} onChange={(e) => setServiceAdvisor(e.target.value)} className={input}>
              <option value="">Choose…</option>
              {options.advisors.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Field>
          <Field title="Vehicle model *">
            <select value={model} onChange={(e) => setModel(e.target.value)} className={input}>
              <option value="">Choose…</option>
              {options.models.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Field>
          <Field title="Repair type *">
            <select value={repairType} onChange={(e) => setRepairType(e.target.value)} className={input}>
              <option value="">Choose…</option>
              {QC_REPAIR_TYPES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field title="Replaced parts">
          <textarea value={replacedParts} onChange={(e) => setReplacedParts(e.target.value)} rows={3} className={input} placeholder="Part numbers / names" />
        </Field>
        <Field title="Defect description (of the replaced parts)">
          <textarea value={defectDescription} onChange={(e) => setDefectDescription(e.target.value)} rows={3} className={input} />
        </Field>
      </div>

      <div className={card}>
        <div className="text-sm font-bold text-neutral-900">Result</div>
        <ResultFields result={result} setResult={setResult} comment={comment} setComment={setComment} finalOdometer={finalOdometer} setFinalOdometer={setFinalOdometer} />
      </div>

      <div className={card}>
        <div className="text-sm font-bold text-neutral-900">Files (for your reference)</div>
        <FilesField
          files={{
            ...files,
            add: async (l) => {
              wipLocked.current = wip;
              await files.add(l);
            },
          }}
        />
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{error}</p>}
      <button disabled={saving || files.busy} className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50">
        {files.busy ? "Uploading files…" : saving ? "Saving…" : "Submit"}
      </button>
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
    router.refresh();
  }

  return (
    <form onSubmit={submit} className={card}>
      <div className="text-sm font-bold text-neutral-900">Test again</div>
      <Field title="Technician(s) who did the rework *" hint="Change it if the workshop gave the job to another technician.">
        <TechnicianPicker options={options.technicians} value={technicians} onChange={setTechnicians} />
      </Field>
      <ResultFields result={result} setResult={setResult} comment={comment} setComment={setComment} finalOdometer={finalOdometer} setFinalOdometer={setFinalOdometer} />
      <FilesField files={files} />
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{error}</p>}
      <button disabled={saving || files.busy} className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-50">
        {files.busy ? "Uploading files…" : saving ? "Saving…" : "Save the test"}
      </button>
    </form>
  );
}
