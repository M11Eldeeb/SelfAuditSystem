// Browser-side helpers for the incremental claims upload: hash every parsed claim, compare with the hashes already
// stored (claims_upload_manifest), and split the file into the claims that must be written and the ones that are
// identical to what is stored. No "server-only" here on purpose - this runs in the browser.
import type { ParsedClaimRow } from "@/lib/parse-claims";

export type StoredClaim = { id: string; hash: string | null };
export type StoredClaims = Map<string, StoredClaim>;

export type HashedClaim = ParsedClaimRow & { source_hash: string };

export const claimKey = (branchId: string, claimNumber: string) => `${branchId}|${claimNumber}`;

/** Same JSON for the same content, whatever the key order. */
function canonicalJson(claim: ParsedClaimRow): string {
  return JSON.stringify(claim, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : value
  );
}

export async function hashClaim(claim: ParsedClaimRow): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(claim));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Reads one branch's claims_upload_manifest answer ([id, claim_number, hash] triples) into `into`. */
export function addManifest(branchId: string, manifest: unknown, into: StoredClaims): void {
  if (!Array.isArray(manifest)) throw new Error("Unexpected answer from claims_upload_manifest.");
  for (const entry of manifest) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || typeof entry[1] !== "string") throw new Error("Unexpected row in claims_upload_manifest.");
    into.set(claimKey(branchId, entry[1]), { id: entry[0], hash: typeof entry[2] === "string" ? entry[2] : null });
  }
}

/**
 * `changed`: new claims and claims whose content differs from the stored copy - these are written.
 * `keptIds`: ids of stored claims that are identical to the file - these are not touched, only remembered
 * as "in this upload" (add_kept_claims). A claim whose stored hash is missing (uploaded before hashes
 * existed) always counts as changed, so the worst case is a full upload, never a wrongly skipped claim.
 */
export async function splitClaims(claims: ParsedClaimRow[], stored: StoredClaims): Promise<{ changed: HashedClaim[]; keptIds: string[] }> {
  const changed: HashedClaim[] = [];
  const keptIds: string[] = [];
  // A claim that appears twice in the file is always written, so the last copy wins exactly as before.
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const c of claims) {
    const key = claimKey(c.branch_id, c.claim_number);
    if (seen.has(key)) repeated.add(key);
    seen.add(key);
  }
  const HASH_BATCH = 500;
  for (let i = 0; i < claims.length; i += HASH_BATCH) {
    const slice = claims.slice(i, i + HASH_BATCH);
    const hashes = await Promise.all(slice.map(hashClaim));
    slice.forEach((claim, j) => {
      const key = claimKey(claim.branch_id, claim.claim_number);
      const hit = stored.get(key);
      if (hit && hit.hash && hit.hash === hashes[j] && !repeated.has(key)) keptIds.push(hit.id);
      else changed.push({ ...claim, source_hash: hashes[j] });
    });
  }
  return { changed, keptIds };
}
