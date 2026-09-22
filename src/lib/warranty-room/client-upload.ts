// Shared by every Warranty Room / claims upload form - no "server-only" here
// on purpose, this runs in the browser.

/**
 * Tiny phase-duration tracker so a slow upload can be split into "which
 * phase" (reading/parsing the file vs. each upload stage) instead of one
 * opaque total - reading a large .xlsx client-side (ExcelJS) is CPU-bound
 * browser work that upload-speed fixes to the network/DB side never touch,
 * so telling the two apart from real numbers beats guessing a second time.
 */
export function createPhaseTimer() {
  const phases: { label: string; ms: number }[] = [];
  let start = performance.now();
  return {
    mark(label: string) {
      phases.push({ label, ms: Math.round(performance.now() - start) });
      start = performance.now();
    },
    summary(): string {
      return phases.map((p) => `${p.label} ${(p.ms / 1000).toFixed(1)}s`).join(" · ");
    },
  };
}

/**
 * Ceiling on how long a single chunk request is allowed to run before it's
 * aborted client-side. A stuck browser tab (crashed render, killed network,
 * a refresh that orphans the in-flight request) used to be able to leave a
 * request running against the database with nothing on the client able to
 * stop it - normal Cancel-button logic only stops the NEXT chunk from being
 * sent, not one already in flight. This is the hard backstop: whatever
 * happens, no single request can hold a database connection open past this.
 * Set well above the well under 1s a healthy 300-row chunk takes (verified
 * via EXPLAIN ANALYZE against real data) so ordinary slowness under real
 * production load - which has been substantial on this project's free tier -
 * is never cut off before it has a real chance to finish.
 */
export const CHUNK_TIMEOUT_MS = 45_000;

/**
 * An AbortController that also fires on its own after CHUNK_TIMEOUT_MS, and
 * can be aborted early (Cancel button, or a new chunk starting - only one
 * request is ever in flight at CONCURRENCY=1). Always call `clear()` once
 * the request settles, success or failure, to release the timer.
 */
export function createChunkAbort(): { signal: AbortSignal; controller: AbortController; clear: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CHUNK_TIMEOUT_MS);
  return { signal: controller.signal, controller, clear: () => clearTimeout(timeoutId) };
}

/**
 * POSTs JSON and always resolves to a result object rather than throwing -
 * a network failure or an unparsable response (e.g. a proxy's HTML error
 * page for a 504) becomes { error }, same shape as a real API error. Always
 * bounded by CHUNK_TIMEOUT_MS (or an explicit `signal`, e.g. from a Cancel
 * button) so a hung request can't hold the connection open indefinitely.
 */
async function postJsonOnce(
  url: string,
  body: unknown,
  signal?: AbortSignal
): Promise<{ error?: string; [key: string]: unknown }> {
  const abort = signal ? null : createChunkAbort();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ?? abort!.signal,
    });
  } catch (err) {
    return { error: err instanceof DOMException && err.name === "AbortError" ? "request timed out." : "network request failed." };
  } finally {
    abort?.clear();
  }
  try {
    const json = await res.json();
    if (!res.ok && !json.error) return { error: `server returned status ${res.status}.` };
    return json;
  } catch {
    if (res.status === 413) return { error: "that chunk was too large for the server to accept." };
    return { error: `server returned an unexpected response (status ${res.status}).` };
  }
}

/**
 * Retries a chunk request on failure - every chunk endpoint upserts on a
 * natural key, so re-sending the same chunk after a timeout is always safe,
 * it just re-applies the same rows. Real exports here run 60,000+ rows, and
 * a Gateway Timeout on any single chunk (transient - the same chunk usually
 * succeeds on retry) used to abort the entire upload, forcing a full restart
 * from row 0. 3 attempts with a short backoff absorbs that without the
 * officer having to do anything.
 */
export async function postJsonWithRetry(
  url: string,
  body: unknown,
  attempts = 3
): Promise<{ error?: string; [key: string]: unknown }> {
  let last: { error?: string; [key: string]: unknown } = { error: "unknown error." };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await postJsonOnce(url, body);
    if (!last.error) return last;
    if (attempt < attempts) await new Promise((r) => setTimeout(r, attempt * 800));
  }
  return last;
}

/**
 * Same idempotent-retry contract as postJsonWithRetry, but for a chunk that
 * calls Supabase directly from the browser (supabase.from(...).upsert(...)
 * or supabase.rpc(...)) instead of going through a Vercel API route. Every
 * caller upserts on a natural key, so retrying after a transient failure is
 * always safe. Returns `data` alongside `error` since some chunk workers
 * (the two matching RPCs) need the row back to report unmatched/merged/added
 * counts to the officer.
 *
 * `fn` receives a fresh AbortSignal every attempt (bounded by
 * CHUNK_TIMEOUT_MS) - the caller must chain it onto the query builder via
 * `.abortSignal(signal)`, so no single attempt can hold a database
 * connection open indefinitely. `onAbortController` (optional) hands back
 * each attempt's controller so a Cancel button can abort the one currently
 * in flight, not just stop future chunks from being sent.
 */
export async function supabaseWithRetry<T>(
  fn: (signal: AbortSignal) => Promise<{ data: T | null; error: { message: string } | null }>,
  onAbortController?: (controller: AbortController) => void,
  attempts = 3
): Promise<{ error?: string; data?: T | null }> {
  let lastError = "unknown error.";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { signal, controller, clear } = createChunkAbort();
    onAbortController?.(controller);
    try {
      const { data, error } = await fn(signal);
      if (!error) return { data };
      lastError = error.message;
    } catch (err) {
      lastError =
        err instanceof DOMException && err.name === "AbortError"
          ? "request timed out or was cancelled."
          : err instanceof Error
            ? err.message
            : "unknown error.";
    } finally {
      clear();
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, attempt * 800));
  }
  return { error: lastError };
}

/**
 * Runs `worker` over every item with at most `concurrency` requests in
 * flight at once. Every call site currently passes 1 (fully sequential) -
 * running several chunks at once was tried and reverted after live testing
 * showed this project's Supabase tier can't absorb concurrent upserts well:
 * individual request latency degraded from ~3s to 60s+ once a few were in
 * flight together, worse than the timeout this exists to avoid. The
 * concurrency parameter is kept in case that changes (a larger Supabase
 * plan, a lighter per-chunk operation) rather than removed outright. Stops
 * issuing new work and returns the first error once one occurs, but lets
 * already-in-flight requests finish first (their rows are safely upserted
 * either way). `isCancelled` is checked the same way, between chunks - it
 * stops the NEXT chunk from being sent. Aborting the CURRENT in-flight
 * request (Cancel button) is a separate mechanism: the caller's `worker`
 * hands its per-attempt AbortController out via supabaseWithRetry's
 * `onAbortController` so a Cancel click can abort it directly.
 */
export async function runChunksWithConcurrency<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<{ error?: string; [key: string]: unknown }>,
  concurrency: number,
  onProgress?: (completed: number, total: number) => void,
  isCancelled?: () => boolean
): Promise<{ error?: string; cancelled?: boolean; results: { error?: string; [key: string]: unknown }[] }> {
  const results: { error?: string; [key: string]: unknown }[] = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;
  let firstError: string | undefined;

  async function runOne(): Promise<void> {
    for (;;) {
      if (isCancelled?.()) return;
      const i = nextIndex++;
      if (i >= items.length) return;
      if (firstError) return;
      const result = await worker(items[i], i);
      results[i] = result;
      completed += 1;
      onProgress?.(completed, items.length);
      if (result.error && !firstError) firstError = result.error;
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runOne());
  await Promise.all(workers);

  return { error: firstError, cancelled: !firstError && !!isCancelled?.(), results };
}
