// Sends one file to a Google Drive resumable upload session in 16 MB pieces. A piece that fails (Wi-Fi drop, timeout) is
// retried after asking Google how much it already has, so a long video does not start again from zero.

const CHUNK = 16 * 1024 * 1024; // must be a multiple of 256 KB - bigger pieces, fewer round trips
const MAX_RETRIES = 8;

type Reply = { status: number; range: string | null; body: string };

function put(url: string, body: Blob | null, contentRange: string, onProgress?: (loaded: number) => void): Promise<Reply> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Range", contentRange);
    xhr.timeout = 5 * 60_000;
    if (onProgress) xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => resolve({ status: xhr.status, range: xhr.getResponseHeader("Range"), body: xhr.responseText });
    xhr.onerror = xhr.ontimeout = xhr.onabort = () => resolve({ status: 0, range: null, body: "" });
    xhr.send(body);
  });
}

/** Bytes Google already holds, from a "Range: bytes=0-N" reply (null when it cannot be read). */
const received = (range: string | null): number | null => {
  const m = range?.match(/bytes=0-(\d+)/);
  return m ? Number(m[1]) + 1 : range === null ? null : 0;
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Uploads `file`; reports progress in bytes. Resolves with the new Drive file id. */
export async function uploadToSession(sessionUrl: string, file: File, onProgress: (sent: number) => void): Promise<string> {
  const size = file.size;
  let offset = 0;
  let retries = 0;
  while (true) {
    const end = Math.min(offset + CHUNK, size);
    const r = await put(sessionUrl, file.slice(offset, end), `bytes ${offset}-${end - 1}/${size}`, (loaded) => onProgress(offset + loaded));
    if (r.status === 200 || r.status === 201) {
      onProgress(size);
      const id = (JSON.parse(r.body || "{}") as { id?: string }).id;
      if (!id) throw new Error(`Google Drive did not confirm "${file.name}".`);
      return id;
    }
    if (r.status === 308) {
      offset = received(r.range) ?? end;
      retries = 0;
      onProgress(offset);
      continue;
    }
    if (r.status === 404 || r.status === 410) throw new Error(`The upload of "${file.name}" expired - please add it again.`);
    if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) throw new Error(`Google Drive refused "${file.name}" (${r.status}).`);
    // Network error, timeout or a Google server error: wait, ask how much arrived, and carry on from there.
    if (++retries > MAX_RETRIES) throw new Error(`The connection kept dropping while sending "${file.name}" - check the Wi-Fi and try again.`);
    await wait(Math.min(30_000, 1000 * 2 ** retries));
    const q = await put(sessionUrl, null, `bytes */${size}`);
    if (q.status === 200 || q.status === 201) {
      onProgress(size);
      const id = (JSON.parse(q.body || "{}") as { id?: string }).id;
      if (id) return id;
    }
    if (q.status === 308) offset = received(q.range) ?? offset;
    onProgress(offset);
  }
}

export const fmtBytes = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
