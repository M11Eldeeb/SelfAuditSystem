"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addTechClaimFiles, finishTechClaim, removeTechClaimFile, startTechClaim, type ClaimFields } from "@/app/actions/tech-claims";
import { fmtBytes, uploadToSession } from "./upload";
import { stampPhoto, stampVideo } from "./stamp";

type Existing = { id: string; name: string; mimeType: string; size: number };

const inputCls = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none";
const icon = (type: string) => (type.startsWith("video/") ? "🎬" : type === "application/pdf" ? "📄" : "📷");

/** datetime-local value (local time) from an ISO date. */
function localValue(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * New claim, or a claim the technician must finish (upload interrupted) or correct (returned by the warranty admin).
 * Files go from the phone straight to Google Drive, one after another, with a progress bar.
 */
export function TechClaimForm({
  who,
  claimId,
  initial,
  existing = [],
}: {
  /** Technician name, printed in the date stamp. */
  who: string;
  claimId?: string;
  initial?: { vin: string; workOrder: string; endOfRepair: string; notes: string | null };
  existing?: Existing[];
}) {
  const router = useRouter();
  const [vin, setVin] = useState(initial?.vin ?? "");
  const [workOrder, setWorkOrder] = useState(initial?.workOrder ?? "");
  const [endOfRepair, setEndOfRepair] = useState(initial ? localValue(initial.endOfRepair) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ label: string; sent: number; total: number } | null>(null);
  const [stamping, setStamping] = useState<string | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const photo = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);

  const add = (list: FileList | null) => {
    if (!list?.length) return;
    // Some phones give no type for HEIC photos or videos: take it from the file name.
    const typed = Array.from(list).map((f) => {
      if (f.type) return f;
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      const t = { heic: "image/heic", heif: "image/heif", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", mp4: "video/mp4", mov: "video/quicktime", "3gp": "video/3gpp", pdf: "application/pdf" }[ext];
      return t ? new File([f], f.name, { type: t, lastModified: f.lastModified }) : f;
    });
    const next = typed.filter((f) => /^(image\/|video\/|application\/pdf$)/.test(f.type));
    if (next.length < list.length) setError("Only photos, videos and PDF files can be added.");
    else setError(null);
    // Every photo and video gets the date stamp before it is added (one at a time; a video takes as long as it lasts).
    for (const f of next) {
      queue.current = queue.current.then(async () => {
        try {
          let out = f;
          if (f.type.startsWith("image/")) {
            setStamping(`Adding the date stamp to ${f.name}...`);
            out = await stampPhoto(f, who);
          } else if (f.type.startsWith("video/")) {
            setStamping(`Adding the date stamp to ${f.name}... 0%`);
            out = await stampVideo(f, who, (pct) => setStamping(`Adding the date stamp to ${f.name}... ${pct}% (keep the screen on)`));
          }
          setFiles((cur) => [...cur, out]);
        } catch (e) {
          setError(e instanceof Error ? e.message : `Could not add "${f.name}".`);
        } finally {
          setStamping(null);
        }
      });
    }
  };

  async function removeExisting(f: Existing) {
    if (!window.confirm(`Remove "${f.name}" from the claim?`)) return;
    setBusy(true);
    const r = await removeTechClaimFile(f.id);
    setBusy(false);
    if (r.error) setError(r.error);
    else router.refresh();
  }

  async function submit() {
    if (stamping) return setError("Wait until the date stamp is added to every file.");
    setError(null);
    const fields: ClaimFields = { vin, workOrder, endOfRepair: endOfRepair ? new Date(endOfRepair).toISOString() : "", notes };
    if (!claimId && !files.length) return setError("Add at least one photo, video or PDF.");
    if (claimId && !files.length && !existing.length) return setError("Add at least one photo, video or PDF.");
    setBusy(true);
    const meta = files.map((f) => ({ name: f.name, type: f.type, size: f.size }));
    let id = claimId;
    let sessions: string[] = [];
    try {
      setProgress({ label: "Preparing the Google Drive folder...", sent: 0, total: 1 });
      if (!id) {
        const r = await startTechClaim(fields, meta);
        if (r.error || !r.claimId) throw new Error(r.error ?? "Could not save the claim.");
        id = r.claimId;
        sessions = r.sessions ?? [];
      } else if (files.length) {
        const r = await addTechClaimFiles(id, meta);
        if (r.error) throw new Error(r.error);
        sessions = r.sessions ?? [];
      }

      const total = files.reduce((s, f) => s + f.size, 0) || 1;
      let done = 0;
      const ids: string[] = [];
      let failed: string | null = null;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const label = `Sending ${i + 1} of ${files.length}: ${f.name}`;
        try {
          ids.push(await uploadToSession(sessions[i], f, (sent) => setProgress({ label, sent: done + sent, total })));
        } catch (e) {
          failed = e instanceof Error ? e.message : `Could not send "${f.name}".`;
          break;
        }
        done += f.size;
      }

      setProgress({ label: failed ? "Saving what was sent..." : "Sending the claim to the warranty admin...", sent: total, total });
      const r = await finishTechClaim(id, ids, claimId ? fields : undefined, !failed);
      if (r.error) throw new Error(r.error);
      if (failed) {
        // The claim is kept (not sent); its page lets the technician add the missing files and send it.
        router.push(`/technician/${id}?interrupted=1`);
        router.refresh();
        return;
      }
      router.push(`/technician/${id}?sent=1`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong - please try again.");
      if (id && !claimId) {
        router.push(`/technician/${id}?interrupted=1`);
        router.refresh();
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const pct = progress ? Math.min(100, Math.round((progress.sent / progress.total) * 100)) : 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70 sm:grid-cols-2">
        <label className="space-y-1 sm:col-span-2">
          <span className="text-sm font-medium text-neutral-700">VIN</span>
          <input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase().replace(/\s+/g, ""))} placeholder="LSJ..." autoCapitalize="characters" className={`${inputCls} font-mono tracking-wide`} disabled={busy} />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium text-neutral-700">Work order</span>
          <input value={workOrder} onChange={(e) => setWorkOrder(e.target.value)} placeholder="Work order number" className={inputCls} disabled={busy} />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium text-neutral-700">End of repair</span>
          <input type="datetime-local" value={endOfRepair} max={localValue(null)} onChange={(e) => setEndOfRepair(e.target.value)} className={inputCls} disabled={busy} />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-sm font-medium text-neutral-700">
            Notes <span className="font-normal text-neutral-400">(optional)</span>
          </span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputCls} disabled={busy} />
        </label>
      </div>

      <div className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
        <div className="text-sm font-semibold text-neutral-900">Photos, videos and PDF</div>
        <input ref={photo} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        <input ref={video} type="file" accept="video/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        <input ref={pick} type="file" accept="image/*,video/*,application/pdf" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        <div className="grid grid-cols-3 gap-2">
          {[
            { ref: photo, label: "📷 Take photo" },
            { ref: video, label: "🎬 Record video" },
            { ref: pick, label: "📎 Choose files" },
          ].map((b) => (
            <button
              key={b.label}
              type="button"
              disabled={busy}
              onClick={() => b.ref.current?.click()}
              className="rounded-lg border-2 border-dashed border-neutral-300 px-2 py-4 text-sm font-medium text-neutral-700 hover:border-brand hover:text-brand disabled:opacity-50"
            >
              {b.label}
            </button>
          ))}
        </div>

        {(existing.length > 0 || files.length > 0) && (
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-100 text-sm">
            {existing.map((f) => (
              <li key={f.id} className="flex items-center gap-2 px-3 py-2">
                <span>{icon(f.mimeType)}</span>
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-xs text-emerald-700">sent</span>
                <span className="text-xs text-neutral-500">{fmtBytes(f.size)}</span>
                <button type="button" disabled={busy} onClick={() => removeExisting(f)} className="text-xs font-medium text-red-600 disabled:opacity-50">
                  Remove
                </button>
              </li>
            ))}
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2 px-3 py-2">
                <span>{icon(f.type)}</span>
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-xs text-neutral-500">{fmtBytes(f.size)}</span>
                <button type="button" disabled={busy} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} className="text-xs font-medium text-red-600 disabled:opacity-50">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {stamping && <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">{stamping}</p>}
        <p className="text-xs text-neutral-500">Every photo and video gets a date stamp (date and time taken, your name).</p>
        {files.length > 0 && <p className="text-xs text-neutral-500">To send: {files.length} file{files.length === 1 ? "" : "s"}, {fmtBytes(files.reduce((s, f) => s + f.size, 0))}</p>}
      </div>

      {progress && (
        <div className="space-y-2 rounded-xl bg-blue-50 p-4 text-sm text-blue-900">
          <div className="flex justify-between gap-3">
            <span className="min-w-0 truncate">{progress.label}</span>
            <span className="font-semibold">{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-blue-100">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs">Keep this page open until it finishes.</p>
        </div>
      )}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <button type="button" disabled={busy || !!stamping} onClick={submit} className="w-full rounded-lg bg-brand px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50">
        {busy ? "Sending..." : claimId ? "Send to warranty admin" : "Submit claim"}
      </button>
    </div>
  );
}
