// Shared by every Warranty Room / claims upload form - no "server-only" here
// on purpose, this runs in the browser.

/**
 * POSTs JSON and always resolves to a result object rather than throwing -
 * a network failure or an unparsable response (e.g. a proxy's HTML error
 * page for a 504) becomes { error }, same shape as a real API error.
 */
async function postJsonOnce(url: string, body: unknown): Promise<{ error?: string; [key: string]: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { error: "network request failed." };
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
 */
export async function supabaseWithRetry<T>(
  fn: () => Promise<{ data: T | null; error: { message: string } | null }>,
  attempts = 3
): Promise<{ error?: string; data?: T | null }> {
  let lastError = "unknown error.";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { data, error } = await fn();
    if (!error) return { data };
    lastError = error.message;
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
 * either way).
 */
export async function runChunksWithConcurrency<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<{ error?: string; [key: string]: unknown }>,
  concurrency: number,
  onProgress?: (completed: number, total: number) => void
): Promise<{ error?: string; results: { error?: string; [key: string]: unknown }[] }> {
  const results: { error?: string; [key: string]: unknown }[] = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;
  let firstError: string | undefined;

  async function runOne(): Promise<void> {
    for (;;) {
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

  return { error: firstError, results };
}
