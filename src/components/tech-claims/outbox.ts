"use client";

// The claim "outbox": every file added to a technician claim is kept on the phone (IndexedDB) until Google Drive has
// it, with how far it got (stamped, upload session, Drive id). Closing the page no longer loses the work:
// - a claim not sent yet comes back in the form when it is opened again, and its uploads carry on from where they stopped;
// - a claim the technician already pressed Submit / Save on is finished by the background sender (ClaimOutbox, on every
//   technician page) - stamping what is left, resuming the uploads, then sending the claim.

import { addTechClaimEvidence, prepareStagedUpload, reportUploadProblem, submitTechClaim, type ClaimFields } from "@/app/actions/tech-claims";
import { SessionExpired, uploadToSession } from "./upload";
import { stampPhoto, stampVideo } from "./stamp";

export type OutItem = {
  key: string;
  name: string;
  type: string;
  size: number;
  /** The kept bytes are the final (stamped) file. */
  stamped: boolean;
  unstamped?: string;
  session?: string;
  driveId?: string;
};

export type OutEntry = {
  /** "new", "claim:<id>", "evidence:<id>" while being filled in; "sub:<uid>" once Submit / Save was pressed. */
  id: string;
  /** Stable key of the kept files. */
  uid: string;
  who: string;
  claimId?: string;
  evidenceOnly: boolean;
  /** The page the claim was filled in on (to open it again). */
  href?: string;
  fields: ClaimFields;
  submit: null | "save" | "send";
  items: OutItem[];
  /** Which page is working on it, and when it last said so (a page that stops saying so was closed). */
  owner: string;
  beat: number;
  tries?: number;
  lastError?: string;
};

export const TAB = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
export const STALE_MS = 30_000;
export const newUid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
export const nowMs = () => Date.now();
export const scopeId = (claimId: string | undefined, evidenceOnly: boolean) => (!claimId ? "new" : evidenceOnly ? `evidence:${claimId}` : `claim:${claimId}`);

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp)
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open("tc-outbox", 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("entries", { keyPath: "id" });
        r.result.createObjectStore("blobs");
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  dbp.catch(() => (dbp = null));
  return dbp;
}

async function tx<T>(store: "entries" | "blobs", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? (req.result as T) : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** Every outbox call is best effort: a phone without IndexedDB (private window) simply works as before. */
const safe = async <T,>(p: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await p();
  } catch {
    return fallback;
  }
};

export const getEntry = (id: string) => safe(() => tx<OutEntry>("entries", "readonly", (s) => s.get(id)), undefined);
export const listEntries = () => safe(async () => (await tx<OutEntry[]>("entries", "readonly", (s) => s.getAll())) ?? [], [] as OutEntry[]);
export const putEntry = (e: OutEntry) => safe(() => tx("entries", "readwrite", (s) => s.put(e)).then(() => true), false);
export const removeEntryRecord = (id: string) => safe(() => tx("entries", "readwrite", (s) => s.delete(id)).then(() => true), false);
export const putBlob = (uid: string, key: string, b: Blob) => safe(() => tx("blobs", "readwrite", (s) => s.put(b, `${uid}|${key}`)).then(() => true), false);
export const getBlob = (uid: string, key: string) => safe(() => tx<Blob>("blobs", "readonly", (s) => s.get(`${uid}|${key}`)), undefined);
export const deleteBlob = (uid: string, key: string) => safe(() => tx("blobs", "readwrite", (s) => s.delete(`${uid}|${key}`)).then(() => true), false);

/** The entry and all its kept files. */
export async function deleteEntry(e: OutEntry) {
  await Promise.all(e.items.map((i) => deleteBlob(e.uid, i.key)));
  await removeEntryRecord(e.id);
}

/** Changes one entry (read - change - write), so the form and the background sender never undo each other's steps. */
export async function patchEntry(id: string, fn: (e: OutEntry) => OutEntry | null): Promise<OutEntry | null> {
  const cur = await getEntry(id);
  if (!cur) return null;
  const next = fn(cur);
  if (next) await putEntry(next);
  return next;
}

export const patchItem = (id: string, key: string, p: Partial<OutItem>) =>
  patchEntry(id, (e) => ({ ...e, items: e.items.map((i) => (i.key === key ? { ...i, ...p } : i)) }));

/** A page holds the entry while it says so every few seconds. */
export const isFree = (e: OutEntry) => e.owner === TAB || Date.now() - e.beat > STALE_MS;

// ------------------------------------------------------------------ the background sender

/** Stamps (if still needed) and uploads one kept file. Resolves with the Drive id. */
async function finishItem(e: OutEntry, item: OutItem, beat: () => void, onPct: (p: number) => void): Promise<string> {
  if (item.driveId) return item.driveId;
  let blob = await getBlob(e.uid, item.key);
  if (!blob) throw new Error(`"${item.name}" is no longer on this phone - add it again.`);
  let it = item;
  if (!it.stamped && (it.type.startsWith("image/") || it.type.startsWith("video/"))) {
    const file = new File([blob], it.name, { type: it.type });
    const out = it.type.startsWith("image/")
      ? await stampPhoto(file, e.who)
      : await stampVideo(file, e.who, (p) => (beat(), onPct(Math.round(p / 2)))).catch((err) => {
          it = { ...it, unstamped: String(err instanceof Error ? err.message : err).slice(0, 300) };
          return file;
        });
    blob = out;
    it = { ...it, stamped: true, name: out.name, type: out.type, size: out.size, session: undefined };
    await putBlob(e.uid, it.key, out);
    await patchItem(e.id, it.key, it);
  }
  const file = new File([blob], it.name, { type: it.type });
  const fresh = async () => {
    const r = await prepareStagedUpload({ name: it.name, type: it.type, size: it.size });
    if (r.error || !r.session) throw new Error(r.error ?? "Could not start the upload.");
    await patchItem(e.id, it.key, { session: r.session });
    return r.session;
  };
  const pct = (sent: number) => (beat(), onPct(50 + Math.round((sent / Math.max(1, it.size)) * 50)));
  let driveId: string;
  try {
    driveId = it.session ? await uploadToSession(it.session, file, pct, true) : await uploadToSession(await fresh(), file, pct);
  } catch (err) {
    if (!(err instanceof SessionExpired)) throw err;
    driveId = await uploadToSession(await fresh(), file, pct);
  }
  await patchItem(e.id, it.key, { driveId });
  await deleteBlob(e.uid, it.key);
  return driveId;
}

export type Progress = { id: string; wo: string; done: number; total: number; failed?: string };

/**
 * Finishes one claim the technician already pressed Submit / Save on, when no open page is working on it.
 * Resolves true when the claim was sent (the entry is then removed).
 */
export async function finishEntry(id: string, onProgress: (p: Progress) => void): Promise<boolean> {
  const taken = await patchEntry(id, (e) => (e.submit && isFree(e) ? { ...e, owner: TAB, beat: Date.now() } : null));
  if (!taken) return false;
  let last = 0;
  const beat = () => {
    if (Date.now() - last < 5000) return;
    last = Date.now();
    void patchEntry(id, (e) => ({ ...e, owner: TAB, beat: Date.now() }));
  };
  const wo = taken.fields.workOrder;
  const ids: string[] = [];
  try {
    let done = taken.items.filter((i) => i.driveId).length;
    onProgress({ id, wo, done, total: taken.items.length });
    for (const item of taken.items) {
      const fresh = (await getEntry(id))?.items.find((i) => i.key === item.key) ?? item;
      const had = !!fresh.driveId;
      ids.push(await finishItem(taken, fresh, beat, () => onProgress({ id, wo, done, total: taken.items.length })));
      if (!had) onProgress({ id, wo, done: ++done, total: taken.items.length });
    }
    const r = taken.evidenceOnly
      ? await addTechClaimEvidence(taken.claimId!, ids)
      : await submitTechClaim(taken.fields, ids, taken.claimId, taken.submit === "send");
    if (r.error) throw new Error(r.error);
    await deleteEntry(taken);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void reportUploadProblem({ name: `(background) WO ${wo}`, type: "", size: 0, message: `background: ${msg}` });
    // The beat is dropped so the next try (any page, or the next visit) may take it again.
    await patchEntry(id, (e) => ({ ...e, beat: 0, owner: "", tries: (e.tries ?? 0) + 1, lastError: msg.slice(0, 300) }));
    onProgress({ id, wo, done: 0, total: taken.items.length, failed: msg });
    return false;
  }
}

/** Gives the entry a new id (Submit pressed: "new" -> "sub:<uid>", so a new claim can be started meanwhile). */
export async function moveEntry(from: string, to: string, p: Partial<OutEntry>): Promise<boolean> {
  const e = await getEntry(from);
  if (!e) return false;
  if (!(await putEntry({ ...e, ...p, id: to }))) return false;
  if (from !== to) await removeEntryRecord(from);
  return true;
}
