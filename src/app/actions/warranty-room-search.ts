"use server";

import { requireAnyViewer } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/** Claims kept in the warranty room for this many days after verification before they are flagged to scrap. */
const HOLDING_DAYS = 90;

export type RoomState =
  | "holding"
  | "holding_due"
  | "not_verified"
  | "flagged"
  | "supplier_pending"
  | "supplier_collected"
  | "scrapped"
  | "no_parts"
  | "not_held";

export type RoomResult = {
  claimNumber: string;
  workOrder: string | null;
  vin: string | null;
  branch: string;
  claimStatus: string | null;
  verification: string | null;
  heldDays: number | null;
  state: RoomState;
  /** One line explaining the state, e.g. "Flagged to be scrapped - cycle 2026-11, waiting for destroy evidence". */
  detail: string;
  parts: { partNo: string | null; name: string | null; qty: number | null }[];
};

const todayKsa = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000));

/** Officers (all branches) and warranty admins (their branch): a claim's warranty room state by claim number, work order or VIN. */
export async function searchWarrantyRoom(query: string): Promise<{ results?: RoomResult[]; error?: string }> {
  const user = await requireAnyViewer(["officer", "branch_admin"]);
  const q = query.trim().toUpperCase().replace(/\s+/g, "");
  if (q.length < 4) return { error: "Enter at least 4 characters." };
  const admin = createAdminClient();
  const { data: branches } = await admin.from("self_audit_branches").select("id, name, code");
  const nameOf = new Map((branches ?? []).map((b) => [b.id, b.name]));

  // Work order: as typed, or the number with every branch code in front (HER-12345, ...).
  const digits = q.replace(/^[A-Z]{2,4}-?/, "");
  const woCandidates = [...new Set([q, ...(/^\d+$/.test(digits) ? (branches ?? []).filter((b) => b.code).map((b) => `${b.code!.toUpperCase()}-${digits}`) : [])])];
  const cols = "id, claim_number, work_order_no, vin, branch_id, has_parts, verification_date, main_part_name";
  const [byClaim, byWo, byVin] = await Promise.all([
    admin.from("self_audit_claims").select(cols).eq("claim_number", q).limit(20),
    admin.from("self_audit_claims").select(cols).in("work_order_no", woCandidates).limit(20),
    q.length >= 11 ? admin.from("self_audit_claims").select(cols).eq("vin", q).limit(20) : Promise.resolve({ data: [] as never[] }),
  ]);
  const seen = new Set<string>();
  let claims = [...(byClaim.data ?? []), ...(byWo.data ?? []), ...(byVin.data ?? [])].filter((c) => !seen.has(c.id) && seen.add(c.id));
  if (user.role !== "officer") claims = claims.filter((c) => c.branch_id === user.branch_id);
  if (!claims.length) return { results: [] };

  const ids = claims.map((c) => c.id);
  const [{ data: settle }, { data: requests }, { data: legacy }, { data: supplierParts }, { data: parts }, { data: cycles }] = await Promise.all([
    admin.from("self_audit_claim_settlement").select("claim_id, status").in("claim_id", ids),
    admin.from("self_audit_scrap_requests").select("claim_id, status, cycle_id, submitted_at, created_at").in("claim_id", ids),
    admin.from("self_audit_scrapped_parts").select("claim_id, created_at").in("claim_id", ids),
    admin.from("self_audit_supplier_collection_parts").select("claim_id, collection_id").in("claim_id", ids),
    admin.from("self_audit_claim_parts").select("claim_id, part_no, part_name, quantity").in("claim_id", ids),
    admin.from("self_audit_warranty_room_cycles").select("id, cycle_month"),
  ]);
  const collectionIds = [...new Set((supplierParts ?? []).map((p) => p.collection_id))];
  const { data: collections } = collectionIds.length ? await admin.from("self_audit_supplier_collections").select("id, status, collection_date, handed_over_at").in("id", collectionIds) : { data: [] };
  const statusOf = new Map((settle ?? []).map((s) => [s.claim_id, s.status]));
  const monthOf = new Map((cycles ?? []).map((c) => [c.id, c.cycle_month.slice(0, 7)]));
  const collectionOf = new Map((collections ?? []).map((c) => [c.id, c]));
  const today = todayKsa();

  const results: RoomResult[] = claims.map((c) => {
    const claimStatus = statusOf.get(c.id) ?? null;
    const heldDays = c.verification_date ? daysBetween(c.verification_date, today) : null;
    const req = (requests ?? []).find((r) => r.claim_id === c.id);
    const old = (legacy ?? []).find((r) => r.claim_id === c.id);
    const sup = (supplierParts ?? []).filter((p) => p.claim_id === c.id).map((p) => collectionOf.get(p.collection_id)).filter(Boolean);
    let state: RoomState;
    let detail: string;
    if (old || req?.status === "scrapped" || req?.status === "presumed_scrapped") {
      state = "scrapped";
      const at = old?.created_at ?? req?.submitted_at ?? req?.created_at;
      detail = `Already scrapped${req?.status === "presumed_scrapped" ? " (presumed - earlier cycle)" : ""}${at ? ` · ${at.slice(0, 10)}` : ""}`;
    } else if (sup.some((s) => s!.status === "handed_over")) {
      state = "supplier_collected";
      const s = sup.find((x) => x!.status === "handed_over")!;
      detail = `Collected by the supplier${s.handed_over_at ? ` on ${s.handed_over_at.slice(0, 10)}` : ""}`;
    } else if (sup.some((s) => s!.status === "pending")) {
      state = "supplier_pending";
      const s = sup.find((x) => x!.status === "pending")!;
      detail = `Reserved for supplier collection${s.collection_date ? ` - planned ${s.collection_date}` : ""} · keep the part`;
    } else if (req?.status === "pending") {
      state = "flagged";
      detail = `Flagged to be scrapped - cycle ${req.cycle_id ? (monthOf.get(req.cycle_id) ?? "—") : "—"} · waiting for destroy evidence and approval`;
    } else if (!c.has_parts) {
      state = "no_parts";
      detail = "No parts on this claim - nothing to keep in the warranty room";
    } else if (/clos|reject|draft/i.test(claimStatus ?? "")) {
      state = "not_held";
      detail = `Not held - claim status "${claimStatus}"`;
    } else if (heldDays == null) {
      state = "not_verified";
      detail = "Keep the part - holding period starts when the claim is verified (no verification date yet)";
    } else if (heldDays < HOLDING_DAYS) {
      state = "holding";
      detail = `Holding period - keep the part · ${heldDays} of ${HOLDING_DAYS} days, ${HOLDING_DAYS - heldDays} days left`;
    } else {
      state = "holding_due";
      detail = `Holding period over (${heldDays} days) - will be flagged to scrap at the next scrap list generation`;
    }
    return {
      claimNumber: c.claim_number,
      workOrder: c.work_order_no,
      vin: c.vin,
      branch: nameOf.get(c.branch_id) ?? "—",
      claimStatus,
      verification: c.verification_date,
      heldDays,
      state,
      detail,
      parts: (() => {
        const list = (parts ?? []).filter((p) => p.claim_id === c.id).map((p) => ({ partNo: p.part_no, name: p.part_name, qty: p.quantity == null ? null : Number(p.quantity) }));
        return list.length || !c.main_part_name ? list : [{ partNo: null, name: c.main_part_name, qty: null }];
      })(),
    };
  });
  return { results };
}
