"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addTechClaimEvidence,
  discardStagedFile,
  prepareStagedUpload,
  reportUploadProblem,
  removeTechClaimFile,
  submitTechClaim,
  type ClaimFields,
} from "@/app/actions/tech-claims";
import { SessionExpired, fmtBytes, uploadToSession } from "./upload";
import { FAST_BUSY, lastStampMethod, stampPhoto, stampVideo, videoDuration, videoLengthFromFile, videoMeta } from "./stamp";
import {
  TAB,
  deleteBlob,
  deleteEntry,
  getBlob,
  getEntry,
  moveEntry,
  patchEntry,
  patchItem,
  putBlob,
  putEntry,
  newUid,
  nowMs,
  scopeId,
  type OutItem,
} from "./outbox";
import { Glyph } from "@/components/ui/glyph";
import { techT, trServer, type Lang } from "@/lib/i18n/tech";

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
  /** A video this phone could not open to stamp: the original is sent. */
  unstamped?: string; // why the stamp could not be added (shown small, for support)
  /** A note for the technician (e.g. a 4K video on a browser without a video encoder is slow to stamp). */
  hint?: string;
  /** A local link to the file (the stamped one once it is ready), so the technician can look at it before sending. */
  preview?: string;
};

/** A small picture of a file in the list: the photo itself, a still of the video, or the file icon. */
function Thumb({ url, type, onOpen, still }: { url: string | null; type: string; onOpen: () => void; still?: boolean }) {
  const box = "relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-neutral-100 ring-1 ring-neutral-200";
  if (!url) return <span className={`${box} flex items-center justify-center`}>{icon(type)}</span>;
  return (
    <button type="button" onClick={onOpen} className={box} aria-label="View">
      {still || type.startsWith("image/") ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
          {type.startsWith("video/") && <span className="absolute inset-0 flex items-center justify-center text-white drop-shadow">▶</span>}
        </>
      ) : type.startsWith("video/") ? (
        <>
          <video src={`${url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
          <span className="absolute inset-0 flex items-center justify-center text-white drop-shadow">▶</span>
        </>
      ) : (
        <span className="flex h-full w-full items-center justify-center">{icon(type)}</span>
      )}
    </button>
  );
}

/** Full-screen look at one file before sending: the photo, the video (to play), or the PDF. */
function Viewer({ file, onClose }: { file: { url: string; type: string; name: string }; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" role="dialog" aria-modal="true" aria-label={file.name}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <span className="min-w-0 truncate text-sm" dir="ltr">{file.name}</span>
        <button type="button" onClick={onClose} className="rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold">
          ✕
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-2" onClick={onClose}>
        {file.type.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file.url} alt={file.name} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
        ) : file.type.startsWith("video/") ? (
          <video src={file.url} controls autoPlay playsInline className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()} />
        ) : (
          <iframe src={file.url} title={file.name} className="h-full w-full rounded bg-white" onClick={(e) => e.stopPropagation()} />
        )}
      </div>
    </div>
  );
}

const MAX_VIDEO_SECONDS = 180;
const PARALLEL_UPLOADS = 4;

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none";
const icon = (type: string) => (
  <Glyph
    name={
      type.startsWith("video/")
        ? "video"
        : type === "application/pdf"
          ? "pdf"
          : "image"
    }
    className="text-neutral-500"
  />
);

/** datetime-local value (local time) from an ISO date. */
function localValue(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Some phones give no type for HEIC photos or videos: take it from the file name. */
/** Files up to this size are copied into the phone's memory as soon as they are picked. */
const SNAPSHOT_MAX = 150 * 1024 * 1024;

/**
 * Reads a picked file into memory right away. Some phones (e.g. Android with files picked from the Gallery app) hand over
 * a file the browser can open only for a moment or not at all; holding the bytes keeps every later step (stamp, convert,
 * send) from failing halfway. Returns null when the file cannot be read at all.
 */
/** All the files picked together are copied into memory up to this much in total (a phone with little memory keeps the rest as picked). */
const SNAPSHOT_TOTAL_MAX = 500 * 1024 * 1024;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One way of reading a file: 0 = the usual call, 1 = a FileReader, 2 = 4 MB pieces (some Android gallery providers only manage small reads). */
async function readOnce(f: File, how: number): Promise<ArrayBuffer> {
  if (how === 0) return f.arrayBuffer();
  if (how === 1) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.onerror = () => reject(r.error ?? new Error("read failed"));
      r.readAsArrayBuffer(f);
    });
  }
  const out = new Uint8Array(f.size);
  const piece = 4 * 1024 * 1024;
  for (let at = 0; at < f.size; at += piece) out.set(new Uint8Array(await f.slice(at, at + piece).arrayBuffer()), at);
  return out.buffer;
}

async function snapshot(f: File, copy = true): Promise<File | null> {
  if (f.size === 0) return null;
  // Too big (or too much in memory already): only check that it can be opened, and keep the file as picked.
  if (!copy || f.size > SNAPSHOT_MAX) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await f.slice(0, 1024).arrayBuffer();
        return f;
      } catch {
        await sleep(400);
      }
    }
    return null;
  }
  // Three tries, each a different way of reading, with a short wait between: the phone may be busy for a moment.
  for (let how = 0; how < 3; how++) {
    try {
      const bytes = await readOnce(f, how);
      return new File([bytes], f.name, { type: f.type, lastModified: f.lastModified });
    } catch {
      if (how < 2) await sleep(400 * (how + 1));
    }
  }
  return null;
}

function withType(f: File): File {
  if (f.type) return f;
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  const t = {
    heic: "image/heic",
    heif: "image/heif",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    mp4: "video/mp4",
    mov: "video/quicktime",
    "3gp": "video/3gpp",
    "3g2": "video/3gpp2",
    m4v: "video/x-m4v",
    webm: "video/webm",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    wmv: "video/x-ms-wmv",
    flv: "video/x-flv",
    mpg: "video/mpeg",
    mpeg: "video/mpeg",
    ts: "video/mp2t",
    mts: "video/mp2t",
    m2ts: "video/mp2t",
    hevc: "video/mp4",
    pdf: "application/pdf",
  }[ext];
  return t
    ? new File([f], f.name, { type: t, lastModified: f.lastModified })
    : f;
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
  lang = "en",
  branchCode = "",
  evidenceOnly = false,
}: {
  /** Technician name, printed in the date stamp. */
  who: string;
  claimId?: string;
  initial?: {
    vin: string;
    workOrder: string;
    endOfRepair: string | null;
    notes: string | null;
  };
  existing?: Existing[];
  lang?: Lang;
  /** Put in front of the work order number the technician types (e.g. HER-). */
  branchCode?: string;
  /** Additional evidence for a claim already sent: only the files, added to the claim (claimId). */
  evidenceOnly?: boolean;
}) {
  const t = techT(lang);
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  // The VIN is not asked from the technician (an existing one is kept as it is).
  const vin = initial?.vin ?? "";
  // The technician types the work order number only; the branch code is added in front when saving.
  const [workOrder, setWorkOrder] = useState(
    (initial?.workOrder ?? "").replace(/^[A-Za-z]+-/, ""),
  );
  // The end of repair is not asked any more; an older claim keeps the one it has.
  const endOfRepair = initial?.endOfRepair ? localValue(initial.endOfRepair) : "";
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [items, setItems] = useState<Item[]>([]);
  // Local links made for previews: freed when the form goes away.
  const previews = useRef(new Set<string>());
  const [viewing, setViewing] = useState<{ url: string; type: string; name: string } | null>(null);
  useEffect(() => {
    const all = previews.current;
    return () => all.forEach((u) => URL.revokeObjectURL(u));
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);

  // Background work: original files, the promise of each item, the stamping chain, the upload slots.
  // A browser without a video encoder (Firefox on Android) is far slower with videos and can come out black: suggest Chrome.
  const [slowBrowser, setSlowBrowser] = useState(false);
  useEffect(() => {
    queueMicrotask(() => setSlowBrowser(typeof VideoEncoder === "undefined" && /Firefox/i.test(navigator.userAgent)));
  }, []);
  const sources = useRef(new Map<string, File>());
  /** "3840x2160, 120s" of each video picked, for the timing line in the upload problems. */
  const videoFacts = useRef(new Map<string, string>());
  const jobs = useRef(new Map<string, Promise<void>>());
  const removed = useRef(new Set<string>());
  const seq = useRef(0);
  const latest = useRef<Item[]>([]);
  // Photos and videos are stamped on separate tracks, so a long video never holds up the photos. Two videos are stamped at the same
  // time when the phone has a hardware video encoder (the stamping, not the sending, is what takes the time); if the hardware
  // refuses the second one it is run again alone and the rest go one at a time.
  const photoChain = useRef<Promise<unknown>>(Promise.resolve());
  const videoSlots = useRef({ limit: typeof VideoEncoder !== "undefined" ? 2 : 1, running: 0, waiting: [] as (() => void)[] });
  // The first upload makes sure the Drive staging folder exists; after that, sessions are asked for in parallel.
  const sessionChain = useRef<Promise<unknown>>(Promise.resolve());
  const stagingReady = useRef(false);

  // The outbox (kept on the phone): files and their progress survive the page being closed (see outbox.ts).
  const scope = scopeId(claimId, evidenceOnly);
  const entryId = useRef(scope);
  const uid = useRef("");
  const owner = useRef("");
  const submitting = useRef<Promise<unknown>>(Promise.resolve());
  const persisted = useRef(new Map<string, OutItem>());
  const [kept, setKept] = useState(false);
  const outboxChain = useRef<Promise<unknown>>(Promise.resolve());
  /** Outbox writes one after another (each reads and writes the entry). Never throws. */
  const ob = (fn: () => Promise<unknown>) => {
    outboxChain.current = outboxChain.current.then(fn).catch(() => undefined);
    return outboxChain.current;
  };
  const fieldsNow = useRef({ workOrder: "", notes: "" });
  const ensureEntry = async () => {
    if (uid.current) return true;
    const id = newUid();
    const ok = await putEntry({
      id: entryId.current,
      uid: id,
      who,
      claimId,
      evidenceOnly,
      href: location.pathname + location.search,
      fields: { vin, workOrder: fieldsNow.current.workOrder, endOfRepair: "", notes: fieldsNow.current.notes },
      submit: null,
      items: [],
      owner: owner.current,
      beat: nowMs(),
    });
    if (ok) {
      uid.current = id;
      setKept(true);
    }
    return ok;
  };
  const keepItem = (key: string, file: File) =>
    ob(async () => {
      if (!(await ensureEntry())) return;
      const it: OutItem = { key, name: file.name, type: file.type, size: file.size, stamped: !/^(image|video)\//.test(file.type) };
      persisted.current.set(key, it);
      if (!(await putBlob(uid.current, key, file))) return;
      await patchEntry(entryId.current, (e) => ({ ...e, items: [...e.items.filter((x) => x.key !== key), it] }));
    });
  const keepPatch = (key: string, p: Partial<OutItem>, blob?: Blob) =>
    ob(async () => {
      if (!uid.current) return;
      const cur = persisted.current.get(key);
      if (cur) persisted.current.set(key, { ...cur, ...p });
      if (blob) await putBlob(uid.current, key, blob);
      await patchItem(entryId.current, key, p);
      if (p.driveId) await deleteBlob(uid.current, key);
    });

  // Load the stamping tools as soon as the form opens, so the first file does not wait for them.
  useEffect(() => {
    void import("exifr");
    void import("mediabunny");
  }, []);
  const slots = useRef({
    free: PARALLEL_UPLOADS,
    waiting: [] as (() => void)[],
  });

  // Every change goes through here so the list is also readable right away (latest) - not only after a render.
  const update = (fn: (cur: Item[]) => Item[]) => {
    latest.current = fn(latest.current);
    setItems(latest.current);
  };
  const patch = (key: string, p: Partial<Item>) =>
    update((cur) => cur.map((it) => (it.key === key ? { ...it, ...p } : it)));
  const inOrder = <T,>(
    chain: React.RefObject<Promise<unknown>>,
    fn: () => Promise<T>,
  ): Promise<T> => {
    const run = chain.current.then(fn, fn);
    chain.current = run.catch(() => undefined);
    return run;
  };
  const withVideoSlot = async <T,>(fn: () => Promise<T>): Promise<T> => {
    const v = videoSlots.current;
    if (v.running < v.limit) v.running++;
    else await new Promise<void>((r) => v.waiting.push(r)); // the slot is handed over already counted
    try {
      return await fn();
    } finally {
      v.running--;
      while (v.waiting.length && v.running < v.limit) {
        v.running++;
        v.waiting.shift()!();
      }
    }
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
        const isVideo = original.type.startsWith("video/");
        const before = persisted.current.get(key);
        const t0 = Date.now();
        const stampOne = async (alone: boolean): Promise<File | null> => {
          if (removed.current.has(key)) return null;
          patch(key, { status: "stamping", pct: 0 });
          if (original.type.startsWith("image/"))
            return stampPhoto(original, who);
          if (original.type.startsWith("video/"))
            // Some phone videos (e.g. HEVC / HDR from the gallery) cannot be opened by the browser to stamp:
            // send the original rather than block the claim.
            return stampVideo(original, who, (pct) => patch(key, { pct }), undefined, { concurrent: !alone && videoSlots.current.running > 1 }).catch((e) => {
              if (e instanceof Error && e.message === FAST_BUSY) throw e;
              const why = (e instanceof Error ? e.message : String(e)) || "?";
              patch(key, { unstamped: why.slice(0, 300) });
              void keepPatch(key, { unstamped: why.slice(0, 300) });
              void reportUploadProblem({ name: original.name, type: original.type, size: original.size, message: `stamp: ${why}` });
              return original;
            });
          return original;
        };
        const stamped = before?.stamped
          ? original
          : isVideo
            ? await withVideoSlot(() => stampOne(false)).catch(async (e) => {
                if (!(e instanceof Error) || e.message !== FAST_BUSY) throw e;
                // Stamped alongside another video and the hardware could not keep up: from now on one at a time, and this one again.
                videoSlots.current.limit = 1;
                void reportUploadProblem({ name: original.name, type: original.type, size: original.size, message: "stamp: two videos at once did not work on this phone - one at a time from now on" });
                return withVideoSlot(() => stampOne(true));
              })
            : await inOrder(photoChain, () => stampOne(true));
        if (!stamped || removed.current.has(key)) return;
        const stampSecs = Math.round((Date.now() - t0) / 1000);
        if (!before?.stamped)
          void keepPatch(key, { stamped: true, name: stamped.name, type: stamped.type, size: stamped.size, session: undefined }, stamped !== original ? stamped : undefined);
        // 2. An upload session in the staging folder, then the bytes straight to Google Drive (three at a time).
        const ask = () =>
          prepareStagedUpload({
            name: stamped.name,
            type: stamped.type,
            size: stamped.size,
          });
        const newSession = async () => {
          const prepared = stagingReady.current
            ? await ask()
            : await inOrder(sessionChain, ask);
          if (prepared.error || !prepared.session)
            throw new Error(prepared.error ?? "Could not start the upload.");
          stagingReady.current = true;
          void keepPatch(key, { session: prepared.session });
          return prepared.session;
        };
        // A file restored from the outbox carries on in its old upload session (Google keeps what already arrived).
        const oldSession = before?.stamped ? before.session : undefined;
        const session = oldSession ?? (await newSession());
        let preview: string | undefined;
        if (stamped !== original) {
          preview = URL.createObjectURL(stamped);
          previews.current.add(preview);
        }
        patch(key, {
          status: "sending",
          pct: 0,
          size: stamped.size,
          name: stamped.name,
          ...(preview ? { preview, type: stamped.type } : {}),
        });
        const t1 = Date.now();
        const onSent = (sent: number) =>
          patch(key, { pct: Math.round((sent / stamped.size) * 100) });
        const driveId = await withSlot(async () => {
          try {
            return await uploadToSession(session, stamped, onSent, !!oldSession);
          } catch (e) {
            if (!(e instanceof SessionExpired) || !oldSession) throw e;
            return uploadToSession(await newSession(), stamped, onSent);
          }
        });
        void keepPatch(key, { driveId });
        // How long a video took (to see what makes the sending slow): stamp method and seconds, upload seconds, sizes.
        if (isVideo && !before?.stamped)
          void reportUploadProblem({
            name: original.name,
            type: stamped.type,
            size: stamped.size,
            message: `timing: ${stamped === original ? "unstamped" : lastStampMethod} stamp ${stampSecs}s, upload ${Math.round((Date.now() - t1) / 1000)}s, ${fmtBytes(original.size)} -> ${fmtBytes(stamped.size)}${videoFacts.current.get(key) ? ` (video ${videoFacts.current.get(key)})` : ""}`,
          });
        if (removed.current.has(key)) {
          void discardStagedFile(driveId);
          return;
        }
        patch(key, { status: "ready", pct: 100, driveId });
      } catch (e) {
        void reportUploadProblem({ name: original.name, type: original.type, size: original.size, message: `failed: ${e instanceof Error ? e.message : String(e)}` });
        patch(key, {
          status: "failed",
          error: e instanceof Error ? trServer(t, e.message) : t.errGeneric,
        });
      }
    })();
    jobs.current.set(key, job);
  }

  async function add(list: FileList | null) {
    // Diagnostics: the phone came back from the picker with no file (an iPhone that could not prepare the video).
    if (!list?.length) {
      void reportUploadProblem({ name: "(none)", type: "", size: 0, message: "picked: the picker returned no file" });
      return;
    }
    setError(null);
    // First every picked file is read into memory, one after the other, BEFORE any stamping starts: a phone busy decoding the first
    // video could no longer read the next ones from the gallery (they were refused as "cannot be read").
    const picked: File[] = [];
    let held = 0;
    for (const raw of Array.from(list)) {
      // Diagnostics: every video (or file without a type) as the phone handed it over.
      if (!raw.type || raw.type.startsWith("video/"))
        void reportUploadProblem({ name: raw.name, type: raw.type || "(no type)", size: raw.size, message: "picked: video handed over by the phone" });
      const typed = withType(raw);
      const f = await snapshot(typed, held + typed.size <= SNAPSHOT_TOTAL_MAX);
      if (!f) {
        setError(t.errUnreadable(typed.name));
        void reportUploadProblem({ name: typed.name, type: typed.type, size: typed.size, message: "unreadable: the picked file could not be read (permission or the gallery app)" });
        continue;
      }
      if (f !== typed && f.size <= SNAPSHOT_MAX) held += f.size;
      picked.push(f);
    }
    for (const f of picked) {
      if (!/^(image\/|video\/|application\/pdf$)/.test(f.type)) {
        setError(t.errType(f.name));
        void reportUploadProblem({ name: f.name, type: f.type || "(no type)", size: f.size, message: "type: not a photo, video or PDF" });
        continue;
      }
      if (f.type.startsWith("video/")) {
        // The video's own header when the browser cannot open it to tell (Firefox on Android): so a long video is still turned away.
        const secs = (await videoDuration(f)) ?? (await videoLengthFromFile(f));
        // Logged so a phone that cannot open videos shows up in the upload problems.
        if (secs == null) void reportUploadProblem({ name: f.name, type: f.type, size: f.size, message: "duration: the phone did not give the video's length (sent anyway)" });
        if (secs != null && secs > MAX_VIDEO_SECONDS + 0.5) {
          setError(t.errVideoLong(f.name, Math.round(secs), MAX_VIDEO_SECONDS));
          continue;
        }
      }
      const key = `f${++seq.current}`;
      sources.current.set(key, f);
      let hint: string | undefined;
      if (f.type.startsWith("video/")) {
        const info = await videoMeta(f).catch(() => null);
        if (info) {
          videoFacts.current.set(key, `${info.w}x${info.h}${info.seconds ? `, ${Math.round(info.seconds)}s` : ""}`);
          // Without a hardware video encoder (Firefox on Android) a video is stamped as it plays - and a 4K one plays slowly there.
          if (typeof VideoEncoder === "undefined" && info.w * info.h > 2_200_000) hint = t.big4k;
        }
      }
      void keepItem(key, f);
      const preview = URL.createObjectURL(f);
      previews.current.add(preview);
      update((cur) => [
        ...cur,
        {
          key,
          name: f.name,
          type: f.type,
          size: f.size,
          status: "waiting",
          pct: 0,
          preview,
          hint,
        },
      ]);
      process(key);
    }
  }

  function remove(it: Item) {
    removed.current.add(it.key);
    if (it.driveId) void discardStagedFile(it.driveId);
    persisted.current.delete(it.key);
    void ob(async () => {
      if (!uid.current) return;
      await deleteBlob(uid.current, it.key);
      await patchEntry(entryId.current, (e) => ({ ...e, items: e.items.filter((x) => x.key !== it.key) }));
    });
    update((cur) => cur.filter((x) => x.key !== it.key));
  }

  function retry(it: Item) {
    patch(it.key, { status: "waiting", pct: 0, error: undefined });
    process(it.key);
  }

  async function removeExisting(f: Existing) {
    if (!window.confirm(t.removeConfirm(f.name))) return;
    setBusy(true);
    const r = await removeTechClaimFile(f.id);
    setBusy(false);
    if (r.error) setError(trServer(t, r.error));
    else router.refresh();
  }

  // Leaving the page while files are on their way (or sent but not submitted) asks first.
  const unsent = items.length > 0 && !kept;
  useEffect(() => {
    if (!unsent) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsent]);

  // Restore an unsent claim of this page kept on the phone: its fields, the files Drive has, and the rest carries on.
  useEffect(() => {
    let gone = false;
    if (!owner.current) owner.current = `${TAB}:form:${newUid()}`;
    void ob(async () => {
      const e = await getEntry(scope);
      if (gone || !e || e.who !== who || e.submit) return;
      uid.current = e.uid;
      setKept(true);
      await putEntry({ ...e, owner: owner.current, beat: Date.now() });
      if (e.fields.workOrder) setWorkOrder(e.fields.workOrder);
      if (e.fields.notes) setNotes(e.fields.notes);
      for (const it of e.items) {
        const n = Number(it.key.replace(/\D/g, ""));
        if (n > seq.current) seq.current = n;
        if (it.driveId) {
          persisted.current.set(it.key, it);
          update((cur) => [...cur, { key: it.key, name: it.name, type: it.type, size: it.size, status: "ready", pct: 100, driveId: it.driveId, unstamped: it.unstamped }]);
          continue;
        }
        const blob = await getBlob(e.uid, it.key);
        if (!blob) {
          await patchEntry(scope, (x) => ({ ...x, items: x.items.filter((y) => y.key !== it.key) }));
          continue;
        }
        persisted.current.set(it.key, it);
        const f = new File([blob], it.name, { type: it.type });
        sources.current.set(it.key, f);
        const preview = URL.createObjectURL(f);
        previews.current.add(preview);
        update((cur) => [...cur, { key: it.key, name: it.name, type: it.type, size: it.size, status: "waiting", pct: 0, preview, unstamped: it.unstamped }]);
        process(it.key);
      }
    });
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While this page works on the claim it says so; the background sender leaves the claim alone meanwhile. The beat
  // goes on after the page is left in the app until the work started here has settled.
  useEffect(() => {
    const beat = () => void ob(() => (uid.current ? patchEntry(entryId.current, (e) => ({ ...e, owner: owner.current, beat: Date.now() })) : Promise.resolve()));
    const timer = setInterval(beat, 10_000);
    const jobsRef = jobs.current;
    return () => {
      void Promise.allSettled([...jobsRef.values(), submitting.current]).then(() => clearInterval(timer));
    };
  }, []);

  // The fields are kept too.
  useEffect(() => {
    fieldsNow.current = { workOrder, notes };
    if (!uid.current) return;
    const timer = setTimeout(() => void ob(() => patchEntry(entryId.current, (e) => ({ ...e, fields: { ...e.fields, workOrder, notes } }))), 600);
    return () => clearTimeout(timer);
  }, [workOrder, notes]);

  const pending = items.filter(
    (i) =>
      i.status === "waiting" ||
      i.status === "stamping" ||
      i.status === "sending",
  );
  const failed = items.filter((i) => i.status === "failed");
  const overall = items.length
    ? Math.round(
        items.reduce(
          (s, i) =>
            s +
            (i.status === "ready"
              ? 100
              : i.status === "sending"
                ? 50 + i.pct / 2
                : i.status === "stamping"
                  ? i.pct / 2
                  : 0),
          0,
        ) / items.length,
      )
    : 0;

  const [mode, setMode] = useState<"save" | "send">("send");

  /** Save keeps the claim and its evidence without sending it (a draft); Submit sends it to the warranty admin. */
  async function submit(send: boolean) {
    setError(null);
    setMode(send ? "send" : "save");
    const fields: ClaimFields = {
      vin,
      workOrder,
      endOfRepair: endOfRepair ? new Date(endOfRepair).toISOString() : "",
      notes,
    };
    if (send && !items.length && !existing.length) return setError(t.errAddOne);
    const plural = t.errFailed;
    if (failed.length) return setError(plural(failed.length));
    setBusy(true);
    let done: () => void = () => undefined;
    submitting.current = new Promise<void>((r) => (done = r));
    // Files still on their way: the claim is handed to the outbox, so closing the page now does not lose it - the
    // sending carries on the next time the portal is opened.
    const stillGoing = latest.current.some((i) => i.status === "waiting" || i.status === "stamping" || i.status === "sending");
    const handOver = async () => {
      if (!stillGoing || !uid.current) return;
      const to = `sub:${uid.current}`;
      if (await moveEntry(entryId.current, to, { submit: send ? "send" : "save", fields, owner: owner.current, beat: Date.now() })) entryId.current = to;
    };
    const takeBack = async () => {
      if (entryId.current === scope) return;
      if (await moveEntry(entryId.current, scope, { submit: null })) entryId.current = scope;
    };
    const forget = async () => {
      const e = uid.current ? await getEntry(entryId.current) : undefined;
      if (e) await deleteEntry(e);
      uid.current = "";
      entryId.current = scope;
    };
    try {
      await ob(handOver);
      // Wait for what is still being stamped or sent, then read the final state.
      await Promise.allSettled([...jobs.current.values()]);
      const final = latest.current;
      const stillFailed = final.filter((i) => i.status === "failed");
      if (stillFailed.length) throw new Error(plural(stillFailed.length));
      const ids = final
        .filter((i) => i.status === "ready" && i.driveId)
        .map((i) => i.driveId!);
      if (evidenceOnly) {
        if (!ids.length) throw new Error(t.errAddOne);
        const added = await addTechClaimEvidence(claimId!, ids);
        if (added.error) throw new Error(trServer(t, added.error));
        await ob(forget);
        update(() => []);
        router.push(`/technician/${claimId}?added=1`);
        router.refresh();
        return;
      }
      const r = await submitTechClaim(fields, ids, claimId, send);
      if (r.error || !r.claimId)
        throw new Error(r.error ? trServer(t, r.error) : t.errGeneric);
      await ob(forget);
      update(() => []);
      router.push(`/technician/${r.claimId}?${send ? "sent" : "saved"}=1`);
      router.refresh();
    } catch (e) {
      await ob(takeBack);
      setError(e instanceof Error ? e.message : t.errGeneric);
    } finally {
      setBusy(false);
      done();
    }
  }

  const statusText = (it: Item) =>
    it.status === "waiting"
      ? t.itemWaiting
      : it.status === "stamping"
        ? it.type.startsWith("video/")
          ? t.itemStampPct(it.pct)
          : t.itemStamp
        : it.status === "sending"
          ? t.itemSending(it.pct)
          : it.status === "ready"
            ? t.itemReady
            : t.itemFailed;

  return (
    <div className="space-y-4">
      {!evidenceOnly && (
        <div className="grid gap-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium text-neutral-700">
              {t.workOrder}
            </span>
            <div
              dir="ltr"
              className="flex items-stretch overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15"
            >
              {branchCode && (
                <span className="flex items-center bg-neutral-100 px-3 font-mono text-base font-semibold text-neutral-700">
                  {branchCode}-
                </span>
              )}
              <input
                value={workOrder}
                onChange={(e) =>
                  setWorkOrder(e.target.value.replace(/\D/g, ""))
                }
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="123456"
                className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-base focus:outline-none"
                disabled={busy}
              />
            </div>
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-sm font-medium text-neutral-700">
              {t.notesOptional}
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={inputCls}
              disabled={busy}
            />
          </label>
        </div>
      )}

      <div className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
        <div className="text-sm font-semibold text-neutral-900">
          {t.evidenceTitle}
        </div>
        <input
          ref={camera}
          type="file"
          accept="image/*,video/*"
          capture="environment"
          hidden
          onChange={(e) => {
            // The box is emptied only after every picked file has been read (emptying it earlier can cut the phone's access to them).
            const input = e.currentTarget;
            void add(input.files).finally(() => {
              input.value = "";
            });
          }}
        />
        <input
          ref={gallery}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => {
            // The box is emptied only after every picked file has been read (emptying it earlier can cut the phone's access to them).
            const input = e.currentTarget;
            void add(input.files).finally(() => {
              input.value = "";
            });
          }}
        />
        <input
          ref={filesInput}
          type="file"
          accept="application/pdf,image/*,video/*"
          multiple
          hidden
          onChange={(e) => {
            // The box is emptied only after every picked file has been read (emptying it earlier can cut the phone's access to them).
            const input = e.currentTarget;
            void add(input.files).finally(() => {
              input.value = "";
            });
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => setSheet(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-300 px-4 py-5 text-[15px] font-semibold text-neutral-800 hover:border-brand hover:text-brand disabled:opacity-50"
        >
          <Glyph name="upload" size={22} className="text-brand" />
          {t.uploadEvidence}
        </button>
        <p className="text-xs text-neutral-500">
          {t.evidenceHelp(MAX_VIDEO_SECONDS)}
        </p>

        {/* Choice sheet (as on iPhone): take, gallery, files - or cancel. */}
        {sheet && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-3 sm:items-center"
            onClick={() => setSheet(false)}
            role="dialog"
            aria-modal="true"
            aria-label={t.uploadEvidence}
          >
            <div
              className="w-full max-w-sm space-y-2"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="overflow-hidden rounded-2xl bg-[var(--surface)] shadow-xl">
                {[
                  {
                    ref: camera,
                    label: t.takePhotoVideo,
                    glyph: "camera" as const,
                  },
                  {
                    ref: gallery,
                    label: t.fromGallery,
                    glyph: "image" as const,
                  },
                  {
                    ref: filesInput,
                    label: t.uploadFiles,
                    glyph: "file" as const,
                  },
                ].map((o, k) => (
                  <button
                    key={o.label}
                    type="button"
                    onClick={() => {
                      setSheet(false);
                      o.ref.current?.click();
                    }}
                    className={`flex w-full items-center gap-3 px-5 py-4 text-start text-[16px] font-medium text-neutral-900 hover:bg-neutral-900/[0.04] ${k ? "border-t border-neutral-900/[0.07]" : ""}`}
                  >
                    <Glyph name={o.glyph} size={22} className="text-brand" />
                    {o.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setSheet(false)}
                className="w-full rounded-2xl bg-[var(--surface)] px-5 py-4 text-[16px] font-semibold text-brand shadow-xl hover:bg-neutral-50"
              >
                {t.cancel}
              </button>
            </div>
          </div>
        )}

        {slowBrowser && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t.slowBrowser}</p>}
        {(existing.length > 0 || items.length > 0) && (
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-100 text-sm">
            {existing.map((f) => (
              <li key={f.id} className="flex items-center gap-2 px-3 py-2">
                <Thumb
                  // Files already on the claim: Drive's small preview picture (a video is not downloaded for it).
                  url={f.mimeType.startsWith("image/") || f.mimeType.startsWith("video/") ? `/api/tech-claims/file/${f.id}?thumb=1` : null}
                  still
                  type={f.mimeType}
                  onOpen={() => setViewing({ url: `/api/tech-claims/file/${f.id}`, type: f.mimeType, name: f.name })}
                />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                {(f.mimeType.startsWith("image/") || f.mimeType.startsWith("video/") || f.mimeType === "application/pdf") && (
                  <button type="button" onClick={() => setViewing({ url: `/api/tech-claims/file/${f.id}`, type: f.mimeType, name: f.name })} className="text-xs font-semibold text-brand">
                    {t.preview}
                  </button>
                )}
                <span className="text-xs text-emerald-700">{t.saved}</span>
                <span className="text-xs text-neutral-500">
                  {fmtBytes(f.size)}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removeExisting(f)}
                  className="text-xs font-medium text-red-600 disabled:opacity-50"
                >
                  {t.remove}
                </button>
              </li>
            ))}
            {items.map((it) => (
              <li key={it.key} className="space-y-1.5 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Thumb url={it.preview ?? null} type={it.type} onOpen={() => it.preview && setViewing({ url: it.preview, type: it.type, name: it.name })} />
                  <span className="min-w-0 flex-1 truncate">{it.name}</span>
                  {it.preview && (
                    <button type="button" onClick={() => setViewing({ url: it.preview!, type: it.type, name: it.name })} className="text-xs font-semibold text-brand">
                      {t.preview}
                    </button>
                  )}
                  <span
                    className={`text-xs ${it.status === "ready" ? "text-emerald-700" : it.status === "failed" ? "text-red-700" : "text-neutral-500"}`}
                  >
                    {it.status === "ready" && (
                      <Glyph name="check" size={13} className="me-0.5" />
                    )}
                    {statusText(it)}
                  </span>
                  {it.status === "failed" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => retry(it)}
                      className="text-xs font-semibold text-brand disabled:opacity-50"
                    >
                      {t.retry}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(it)}
                    className="text-xs font-medium text-red-600 disabled:opacity-50"
                  >
                    {t.remove}
                  </button>
                </div>
                {it.hint && it.status !== "ready" && <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">{it.hint}</p>}
                {(it.status === "stamping" || it.status === "sending") && (
                  <div className="h-1 overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className={`h-full rounded-full transition-all ${it.status === "sending" ? "bg-brand" : "bg-neutral-400"}`}
                      style={{ width: `${Math.max(it.pct, 4)}%` }}
                    />
                  </div>
                )}
                {it.unstamped && !it.error && (
                  <>
                    <p className="text-xs text-amber-700">{t.sentUnstamped}</p>
                    <p className="text-[10px] break-all text-slate-400" dir="ltr">{it.unstamped}</p>
                  </>
                )}
                {it.error && <p className="text-xs text-red-700">{it.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {viewing && <Viewer file={viewing} onClose={() => setViewing(null)} />}

      {busy && pending.length > 0 && (
        <div className="space-y-2 rounded-xl bg-neutral-100 p-4 text-sm text-neutral-800">
          <div className="flex justify-between gap-3">
            <span>{t.finishing(pending.length)}</span>
            <span className="font-semibold tabular-nums">{overall}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white">
            <div
              className="h-full rounded-full bg-brand transition-all"
              style={{ width: `${overall}%` }}
            />
          </div>
          <p className="text-xs text-neutral-500">{t.keepOpen}</p>
        </div>
      )}
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {evidenceOnly ? (
        <button
          type="button"
          disabled={busy || !items.length}
          onClick={() => void submit(true)}
          className="w-full rounded-xl bg-brand px-4 py-3 text-base font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {busy
            ? pending.length
              ? t.finishingUploads
              : t.sendingClaim
            : t.sendEvidence}
        </button>
      ) : (
        <div className="grid grid-cols-[1fr_2fr] gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit(false)}
            className="rounded-xl bg-neutral-900/[0.06] px-4 py-3 text-base font-semibold text-neutral-900 hover:bg-neutral-900/[0.1] disabled:opacity-50"
          >
            {busy && mode === "save" ? t.saving : t.save}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit(true)}
            className="rounded-xl bg-brand px-4 py-3 text-base font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {busy && mode === "send"
              ? pending.length
                ? t.finishingUploads
                : t.sendingClaim
              : t.submitToAdmin}
          </button>
        </div>
      )}
      {busy && kept && pending.length > 0 && (
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-center text-sm text-blue-900">{t.canLeave}</p>
      )}
      {!evidenceOnly && (
        <p className="text-center text-xs text-neutral-500">{t.saveHint}</p>
      )}
    </div>
  );
}
