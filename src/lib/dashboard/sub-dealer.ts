import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSheetsStatus, readSheetNamed } from "@/lib/google-sheets";
import { SUB_DEALER_SHEET_ID, normalizeVin, normalizeWorkOrder } from "@/lib/sub-dealer-wips";

/**
 * The Sub-Dealer Dashboard: the sub-dealer's live Google Sheet (Claims and Free Service tabs) set beside what the dealer got
 * on the claims batch for the same work orders. A sheet row and a batch claim belong together when the base work order
 * number AND the VIN match (see src/lib/sub-dealer-wips.ts).
 *
 * Money: "Labor Approved (SAR, VAT incl.)" in the sheet is what came to the sub-dealer; "Adjusted Claim TOL." on the batch is
 * what the dealer is paid for the claim; the rest stays with the dealer.
 */

export type SdClaim = {
  id: string;
  status: string;
  branch: string;
  /** "<base work order>|<VIN>" - the key shared with the batch, null when the row has no work order or VIN. */
  key: string | null;
  workOrder: string;
  subWorkOrder: string;
  vin: string;
  created: string | null;
  month: string | null;
  partsGot: number;
  partsTotal: number;
  parts: { name: string; qty: number }[];
  laborApproved: number | null;
};

export type SdFree = { id: string; status: string; branch: string; workOrder: string; service: string; approved: number | null; created: string | null; month: string | null };

/** What the dealer's claims batch holds for one key (work order + VIN): all its follow-up job cards together. */
export type SdBatch = { claimNumbers: string[]; statuses: string[]; adjusted: number; settled: number };

export type SubDealerDashboard =
  | {
      status: "ok";
      updatedAt: string;
      /** The sheet has the "Labor Approved (SAR, VAT incl.)" column. */
      hasLaborApproved: boolean;
      claims: SdClaim[];
      free: SdFree[];
      batch: Record<string, SdBatch>;
      branches: string[];
      months: string[];
    }
  | { status: "not_connected" }
  | { status: "error"; message: string };

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const text = (v: unknown) => String(v ?? "").trim();

function money(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = text(v).replace(/[^\d.,-]/g, "").replace(/,/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** "11 Nov 2026, 10:51", "2026-11-11" or a Sheets serial number -> "2026-11-11". */
function isoDay(v: unknown): string | null {
  if (typeof v === "number" && v > 20_000 && v < 80_000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000).toISOString().slice(0, 10);
  const t = text(v);
  if (!t) return null;
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ms = Date.parse(`${t} UTC`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
}

/** "SEAL (10710877) x2 [Supplied to Sub-Dealer]; MOUNT-ENG(RH) (10673927) x1 [ICT]" -> [{ name, qty }]. */
function parseParts(v: unknown): { name: string; qty: number }[] {
  return text(v)
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = p.match(/^(.*)\s\([^()]*\)\s*x(\d+)/);
      return m ? { name: m[1].trim(), qty: Number(m[2]) || 1 } : { name: p.replace(/\s*\[[^\]]*\]\s*$/, "").trim(), qty: 1 };
    })
    .filter((p) => p.name);
}

const keyOf = (workOrder: string, vin: string) => {
  const wo = normalizeWorkOrder(workOrder);
  const v = normalizeVin(vin);
  return wo && v ? `${wo}|${v}` : null;
};

type Parsed = { hasLaborApproved: boolean; claims: SdClaim[]; free: SdFree[] };

function parseSheet(claimRows: unknown[][] | null, freeRows: unknown[][] | null): Parsed {
  const claims: SdClaim[] = [];
  let hasLaborApproved = false;
  if (claimRows && claimRows.length) {
    const h = claimRows[0].map(norm);
    const col = (name: string) => h.indexOf(name);
    const approvedCol = h.findIndex((x) => x.startsWith("labor approved"));
    hasLaborApproved = approvedCol !== -1;
    const [id, status, arrived, branch, vin, subWo, dealerWo, created, reception, parts] = [
      "warranty claim id",
      "status",
      "defected parts arrived",
      "branch",
      "vin",
      "work order (sub-dealer)",
      "work order (dealer)",
      "creation date",
      "reception date",
      "parts",
    ].map(col);
    for (const r of claimRows.slice(1)) {
      if (!text(r[id])) continue;
      const day = isoDay(r[created]) ?? isoDay(r[reception]);
      const got = text(r[arrived]).match(/^(\d+)\s*\/\s*(\d+)$/);
      const dealer = text(r[dealerWo]);
      const v = normalizeVin(r[vin]);
      claims.push({
        id: text(r[id]),
        status: text(r[status]) || "unknown",
        branch: text(r[branch]) || "Sub-dealer",
        key: keyOf(dealer, v),
        workOrder: normalizeWorkOrder(dealer) || dealer,
        subWorkOrder: text(r[subWo]),
        vin: v,
        created: day,
        month: day ? day.slice(0, 7) : null,
        partsGot: got ? Number(got[1]) : 0,
        partsTotal: got ? Number(got[2]) : 0,
        parts: parseParts(r[parts]),
        laborApproved: approvedCol === -1 ? null : money(r[approvedCol]),
      });
    }
  }
  const free: SdFree[] = [];
  if (freeRows && freeRows.length) {
    const h = freeRows[0].map(norm);
    const col = (name: string) => h.indexOf(name);
    const [id, status, branch, dealerWo, service, approved, created] = ["free service id", "status", "branch", "work order (dealer)", "service requested", "approved amount", "creation date"].map(col);
    for (const r of freeRows.slice(1)) {
      if (!text(r[id])) continue;
      const day = isoDay(r[created]);
      free.push({
        id: text(r[id]),
        status: text(r[status]) || "unknown",
        branch: text(r[branch]) || "Sub-dealer",
        workOrder: normalizeWorkOrder(r[dealerWo]) || text(r[dealerWo]),
        service: text(r[service]),
        approved: approved === -1 ? null : money(r[approved]),
        created: day,
        month: day ? day.slice(0, 7) : null,
      });
    }
  }
  return { hasLaborApproved, claims, free };
}

/** The sheet is read at most every two minutes; a failed read is never cached. */
const readSheet = unstable_cache(
  async (): Promise<Parsed> => {
    const [claimRows, freeRows] = await Promise.all([readSheetNamed(SUB_DEALER_SHEET_ID, "Claims"), readSheetNamed(SUB_DEALER_SHEET_ID, "Free Service")]);
    if (!claimRows) throw new Error('The sub-dealer sheet has no "Claims" tab.');
    return parseSheet(claimRows, freeRows);
  },
  ["sub-dealer-sheet-v1"],
  { revalidate: 120 }
);

/** The batch side: the dealer's claims whose work order + VIN are on the sub-dealer's list, grouped by that key. */
async function loadBatch(): Promise<Record<string, SdBatch>> {
  const admin = createAdminClient();
  const { data: ids, error } = await admin.rpc("get_sub_dealer_claim_ids");
  if (error) throw new Error(error.message);
  const claimIds = [...new Set(ids ?? [])];
  const batch: Record<string, SdBatch> = {};
  for (let i = 0; i < claimIds.length; i += 150) {
    const chunk = claimIds.slice(i, i + 150);
    const [{ data: settle }, { data: vins }] = await Promise.all([
      admin.from("self_audit_claim_settlement").select("claim_id, claim_number, work_order_no, status, adjusted, settle_vat").in("claim_id", chunk),
      admin.from("self_audit_claims").select("id, vin").in("id", chunk),
    ]);
    const vinOf = new Map((vins ?? []).map((c) => [c.id, c.vin]));
    for (const s of settle ?? []) {
      const key = keyOf(s.work_order_no ?? "", vinOf.get(s.claim_id) ?? "");
      if (!key) continue;
      const b = (batch[key] ??= { claimNumbers: [], statuses: [], adjusted: 0, settled: 0 });
      if (s.claim_number) b.claimNumbers.push(s.claim_number);
      if (s.status && !b.statuses.includes(s.status)) b.statuses.push(s.status);
      b.adjusted += Number(s.adjusted ?? 0);
      b.settled += Number(s.settle_vat ?? 0);
    }
  }
  return batch;
}

export async function loadSubDealerDashboard(): Promise<SubDealerDashboard> {
  if (!(await getSheetsStatus())) return { status: "not_connected" };
  try {
    const [parsed, batch] = await Promise.all([readSheet(), loadBatch()]);
    return {
      status: "ok",
      updatedAt: new Date().toISOString(),
      hasLaborApproved: parsed.hasLaborApproved,
      claims: parsed.claims,
      free: parsed.free,
      batch,
      branches: [...new Set([...parsed.claims, ...parsed.free].map((c) => c.branch))].sort(),
      months: [...new Set([...parsed.claims, ...parsed.free].map((c) => c.month).filter((m): m is string => !!m))].sort(),
    };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Could not read the sub-dealer sheet." };
  }
}
