"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { discardStagedFile, prepareStagedUpload, removeTechClaimFile, submitTechClaim, type ClaimFields } from "@/app/actions/tech-claims";
import { fmtBytes, uploadToSession } from "./upload";
import { stampPhoto, stampVideo, videoDuration } from "./stamp";
import { Glyph } from "@/components/ui/glyph";

type Existing = { id: string; name: string; mimeType: string; size: number };

/** A file added to the form: it is stamped and sent in the background straight away (as WhatsApp does). */
type Item = {
  key: string;
  name: string;
  type: string;
  size: number;
  status: "waiting" | "stamping" | "sending" | "ready" | "failed";
  pct: number;
  driveId?: string;
  error?: string;
};

const MAX_VIDEO_SECONDS = 120;
const PARALLEL_UPLOADS = 3;

const inputCls = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none";
const icon = (type: string) => <Glyph name={type.startsWith("video/") ? "video" : type === "application/pdf" ? "pdf" : "image"} className="text-neutral-500" />;

/** datetime-local value (local time) from an ISO date. */
function localValue(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Some phones give no type for HEIC photos or videos: take it from the file name. */
function withType(f: File): File {
  if (f.type) return f;
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  const t = { heic: "image/heic", heif: "image/heif", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", mp4: "video/mp4", mov: "video/quicktime", "3gp": "video/3gpp", pdf: "application/pdf" }[ext];
  return t ? new File([f], f.name, { type: t, lastModified: f.lastModified }) : f;
}

/**
 * New claim, or a claim the technician must finish or correct (returned by the warranty admin).
 *
 * Speed: every photo / video is date-stamped and uploaded in the background the moment it is added - while the
 * technician still types the VIN and work order - into his staging folder on Google Drive (stamping one at a time, up
 * to three uploads at once). Pressing Submit then only waits for what is still on its way and moves the files into the
 * work order folder.
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
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photo = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const pdf = useRef<HTMLInputElement>(null);

  // Background work: original files, the promise of each item, the stamping chain, the upload slots.
  const sources = useRef(new Map<string, File>());
  const jobs = useRef(new Map<string, Promise<void>>());
  const removed = useRef(new Set<string>());
  const seq = useRef(0);
  const latest = useRef<Item[]>([]);
  const stampChain = useRef<Promise<unknown>>(Promise.resolve());
  const sessionChain = useRef<Promise<unknown>>(Promise.resolve());
  const slots = useRef({ free: PARALLEL_UPLOADS, waiting: [] as (() => void)[] });

  // Every change goes through here so the list is also readable right away (latest) - not only after a render.
  const update = (fn: (cur: Item[]) => Item[]) => {
    latest.current = fn(latest.current);
    setItems(latest.current);
  };
  const patch = (key: string, p: Partial<Item>) => update((cur) => cur.map((it) => (it.key === key ? { ...it, ...p } : it)));
  const inOrder = <T,>(chain: React.RefObject<Promise<unknown>>, fn: () => Promise<T>): Promise<T> => {
    const run = chain.current.then(fn, fn);
    chain.current = run.catch(() => undefined);
    return run;
  };
  const withSlot = async <T,>(fn: () => Promise<T>): Promise<T> => {
    const s = slots.current;
    if (s.free > 0) s.free--;
    else await new Promise<void>((r) => s.waiting.push(r));
    try {
      return await fn();
    } finally {
      const next = s.waiting.shift();
      if (next) next();
      else s.free++;
    }
  };

  function process(key: string) {
    const job = (async () => {
      const original = sources.current.get(key);
      if (!original) return;
      try {
        // 1. Date stamp (one file at a time - it uses the phone's video hardware).
        const stamped = await inOrder(stampChain, async () => {
          if (removed.current.has(key)) return null;
          patch(key, { status: "stamping", pct: 0 });
          if (original.type.startsWith("image/")) return stampPhoto(original, who);
          if (original.type.startsWith("video/")) return stampVideo(original, who, (pct) => patch(key, { pct }));
          return original;
        });
        if (!stamped || removed.current.has(key)) return;
        // 2. An upload session in the staging folder, then the bytes straight to Google Drive (three at a time).
        const prepared = await inOrder(sessionChain, () => prepareStagedUpload({ name: stamped.name, type: stamped.type, size: stamped.size }));
        if (prepared.error || !prepared.session) throw new Error(prepared.error ?? "Could not start the upload.");
        const session = prepared.session;
        patch(key, { status: "sending", pct: 0, size: stamped.size, name: stamped.name });
        const driveId = await withSlot(() => uploadToSession(session, stamped, (sent) => patch(key, { pct: Math.round((sent / stamped.size) * 100) })));
        if (removed.current.has(key)) {
          void discardStagedFile(driveId);
          return;
        }
        patch(key, { status: "ready", pct: 100, driveId });
      } catch (e) {
        patch(key, { status: "failed", error: e instanceof Error ? e.message : "Could not send this file." });
      }
    })();
    jobs.current.set(key, job);
  }

  async function add(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    for (const raw of Array.from(list)) {
      const f = withType(raw);
      if (!/^(image\/|video\/|application\/pdf$)/.test(f.type)) {
        setError(`"${f.name}": only photos, videos and PDF files can be added.`);
        continue;
      }
      if (f.type.startsWith("video/")) {
        const secs = await videoDuration(f);
        if (secs != null && secs > MAX_VIDEO_SECONDS + 0.5) {
          setError(`"${f.name}" is ${Math.round(secs)} seconds long - videos can be up to ${MAX_VIDEO_SECONDS} seconds.`);
          continue;
        }
      }
      const key = `f${++seq.current}`;
      sources.current.set(key, f);
      update((cur) => [...cur, { key, name: f.name, type: f.type, size: f.size, status: "waiting", pct: 0 }]);
      process(key);
    }
  }

  function remove(it: Item) {
    removed.current.add(it.key);
    if (it.driveId) void discardStagedFile(it.driveId);
    update((cur) => cur.filter((x) => x.key !== it.key));
  }

  function retry(it: Item) {
    patch(it.key, { status: "waiting", pct: 0, error: undefined });
    process(it.key);
  }

  async function removeExisting(f: Existing) {
    if (!window.confirm(`Remove "${f.name}" from the claim?`)) return;
    setBusy(true);
    const r = await removeTechClaimFile(f.id);
    setBusy(false);
    if (r.error) setError(r.error);
    else router.refresh();
  }

  // Leaving the page while files are on their way (or sent but not submitted) asks first.
  const unsent = items.length > 0;
  useEffect(() => {
    if (!unsent) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsent]);

  const pending = items.filter((i) => i.status === "waiting" || i.status === "stamping" || i.status === "sending");
  const failed = items.filter((i) => i.status === "failed");
  const overall = items.length
    ? Math.round(items.reduce((s, i) => s + (i.status === "ready" ? 100 : i.status === "sending" ? 50 + i.pct / 2 : i.status === "stamping" ? i.pct / 2 : 0), 0) / items.length)
    : 0;

  async function submit() {
    setError(null);
    const fields: ClaimFields = { vin, workOrder, endOfRepair: endOfRepair ? new Date(endOfRepair).toISOString() : "", notes };
    if (!items.length && !existing.length) return setError("Add at least one photo, video or PDF.");
    const plural = (n: number) => `${n} file${n === 1 ? "" : "s"} could not be sent - press Retry or remove ${n === 1 ? "it" : "them"}.`;
    if (failed.length) return setError(plural(failed.length));
    setBusy(true);
    try {
      // Wait for what is still being stamped or sent, then read the final state.
      await Promise.allSettled([...jobs.current.values()]);
      const final = latest.current;
      const stillFailed = final.filter((i) => i.status === "failed");
      if (stillFailed.length) throw new Error(plural(stillFailed.length));
      const ids = final.filter((i) => i.status === "ready" && i.driveId).map((i) => i.driveId!);
      const r = await submitTechClaim(fields, ids, claimId);
      if (r.error || !r.claimId) throw new Error(r.error ?? "Could not send the claim.");
      update(() => []);
      router.push(`/technician/${r.claimId}?sent=1`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong - please try again.");
    } finally {
      setBusy(false);
    }
  }

  const statusText = (it: Item) =>
    it.status === "waiting"
      ? "Waiting…"
      : it.status === "stamping"
        ? it.type.startsWith("video/")
          ? `Date stamp ${it.pct}%`
          : "Date stamp…"
        : it.status === "sending"
          ? `Sending ${it.pct}%`
          : it.status === "ready"
            ? "Ready"
            : "Not sent";

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
        <input ref={photo} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
        <input ref={video} type="file" accept="video/*" capture="environment" hidden onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
        <input ref={gallery} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
        <input ref={pdf} type="file" accept="application/pdf" multiple hidden onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { ref: photo, label: "Take photo", glyph: "camera" as const },
            { ref: video, label: "Record video", glyph: "video" as const },
            { ref: gallery, label: "From gallery", glyph: "image" as const },
            { ref: pdf, label: "Add PDF", glyph: "pdf" as const },
          ].map((b) => (
            <button
              key={b.label}
              type="button"
              disabled={busy}
              onClick={() => b.ref.current?.click()}
              className="rounded-lg border-2 border-dashed border-neutral-300 px-2 py-4 text-sm font-medium text-neutral-700 hover:border-brand hover:text-brand disabled:opacity-50"
            >
              <Glyph name={b.glyph} size={22} className="mx-auto mb-1 block text-brand" />
              {b.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-neutral-500">
          Files are date-stamped (time taken and your name) and sent while you fill in the claim. Videos up to {MAX_VIDEO_SECONDS} seconds.
        </p>

        {(existing.length > 0 || items.length > 0) && (
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
            {items.map((it) => (
              <li key={it.key} className="space-y-1.5 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span>{icon(it.type)}</span>
                  <span className="min-w-0 flex-1 truncate">{it.name}</span>
                  <span className={`text-xs ${it.status === "ready" ? "text-emerald-700" : it.status === "failed" ? "text-red-700" : "text-neutral-500"}`}>
                    {it.status === "ready" && <Glyph name="check" size={13} className="mr-0.5" />}
                    {statusText(it)}
                  </span>
                  {it.status === "failed" && (
                    <button type="button" disabled={busy} onClick={() => retry(it)} className="text-xs font-semibold text-brand disabled:opacity-50">
                      Retry
                    </button>
                  )}
                  <button type="button" disabled={busy} onClick={() => remove(it)} className="text-xs font-medium text-red-600 disabled:opacity-50">
                    Remove
                  </button>
                </div>
                {(it.status === "stamping" || it.status === "sending") && (
                  <div className="h-1 overflow-hidden rounded-full bg-neutral-100">
                    <div className={`h-full rounded-full transition-all ${it.status === "sending" ? "bg-brand" : "bg-neutral-400"}`} style={{ width: `${Math.max(it.pct, 4)}%` }} />
                  </div>
                )}
                {it.error && <p className="text-xs text-red-700">{it.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {busy && pending.length > 0 && (
        <div className="space-y-2 rounded-xl bg-neutral-100 p-4 text-sm text-neutral-800">
          <div className="flex justify-between gap-3">
            <span>
              Finishing {pending.length} file{pending.length === 1 ? "" : "s"}…
            </span>
            <span className="font-semibold tabular-nums">{overall}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${overall}%` }} />
          </div>
          <p className="text-xs text-neutral-500">Keep this page open until it finishes.</p>
        </div>
      )}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <button type="button" disabled={busy} onClick={submit} className="w-full rounded-lg bg-brand px-4 py-3 text-base font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
        {busy ? (pending.length ? "Finishing uploads…" : "Sending the claim…") : claimId ? "Send to warranty admin" : "Submit claim"}
      </button>
    </div>
  );
}
