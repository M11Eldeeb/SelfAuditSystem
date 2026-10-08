import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Warnings for a part the manufacturer wants back:
 * - scrapped: already destroyed (warranty room scrapped list, or its scrap
 *   request closed as scrapped) - it can't be returned.
 * - flagged: on a pending scrap request - the branch has been told to scrap
 *   it, so it must be stopped before it's destroyed.
 * - supplier: on a supplier collection list (pending pickup or already
 *   handed over to the supplier).
 */
export type PartFlag = { kind: "scrapped" | "flagged" | "supplier"; detail: string };

const norm = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/**
 * Flags for every (claim, part) pair, keyed `${claimId}|${PART_NO}`; a key
 * of `${claimId}|*` means the flag applies to the whole claim (no part
 * number on record). Callers must have checked the caller is an officer -
 * this reads the warranty room tables with the service-role client.
 */
export async function getPartFlags(claimIds: string[]): Promise<Map<string, PartFlag[]>> {
  const flags = new Map<string, PartFlag[]>();
  if (claimIds.length === 0) return flags;
  const add = (claimId: string, partNo: string | null, flag: PartFlag) => {
    const key = `${claimId}|${norm(partNo) || "*"}`;
    const list = flags.get(key) ?? [];
    if (!list.some((f) => f.kind === flag.kind)) list.push(flag);
    flags.set(key, list);
  };

  const admin = createAdminClient();
  const [{ data: scrapped }, { data: requests }, { data: supplier }] = await Promise.all([
    admin.from("self_audit_scrapped_parts").select("claim_id, part_no").in("claim_id", claimIds),
    admin.from("self_audit_scrap_requests").select("id, claim_id, status, submitted_at, created_at").in("claim_id", claimIds),
    admin.from("self_audit_supplier_collection_parts").select("claim_id, part_no, collection_id").in("claim_id", claimIds),
  ]);

  for (const s of scrapped ?? []) {
    if (s.claim_id) add(s.claim_id, s.part_no, { kind: "scrapped", detail: "On the already-scrapped list" });
  }

  const reqIds = (requests ?? []).map((r) => r.id);
  const { data: reqParts } = reqIds.length
    ? await admin.from("self_audit_scrap_request_parts").select("scrap_request_id, part_no").in("scrap_request_id", reqIds)
    : { data: [] as { scrap_request_id: string; part_no: string | null }[] };
  for (const r of requests ?? []) {
    const parts = (reqParts ?? []).filter((p) => p.scrap_request_id === r.id);
    const flag: PartFlag =
      r.status === "scrapped"
        ? { kind: "scrapped", detail: `Scrapped${r.submitted_at ? ` ${new Date(r.submitted_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}` }
        : { kind: "flagged", detail: "Branch told to scrap it - stop before it's destroyed" };
    if (parts.length) for (const p of parts) add(r.claim_id, p.part_no, flag);
    else add(r.claim_id, null, flag);
  }

  const collectionIds = [...new Set((supplier ?? []).map((s) => s.collection_id))];
  const { data: collections } = collectionIds.length
    ? await admin.from("self_audit_supplier_collections").select("id, status, collection_date").in("id", collectionIds)
    : { data: [] as { id: string; status: string; collection_date: string | null }[] };
  const collection = new Map((collections ?? []).map((c) => [c.id, c]));
  for (const s of supplier ?? []) {
    if (!s.claim_id) continue;
    const c = collection.get(s.collection_id);
    add(s.claim_id, s.part_no, {
      kind: "supplier",
      detail: c?.status === "handed_over" ? "Already handed over to the supplier" : `On the supplier pickup list${c?.collection_date ? ` (${c.collection_date})` : ""}`,
    });
  }

  return flags;
}

/** Flags for one part: its own plus any whole-claim flags. */
export function flagsFor(flags: Map<string, PartFlag[]>, claimId: string | null, partNo: string | null): PartFlag[] {
  if (!claimId) return [];
  const own = flags.get(`${claimId}|${norm(partNo) || "*"}`) ?? [];
  const claimWide = norm(partNo) ? (flags.get(`${claimId}|*`) ?? []) : [];
  return [...own, ...claimWide.filter((f) => !own.some((o) => o.kind === f.kind))];
}

/** Gone for good (scrapped, or handed to the supplier) - can't be sent back. */
export function isUnavailable(list: PartFlag[]): boolean {
  return list.some((f) => f.kind === "scrapped" || (f.kind === "supplier" && f.detail.startsWith("Already")));
}
