import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSheetsStatus, readSheetNamed } from "@/lib/google-sheets";
import { SAR_PER_USD } from "@/lib/dashboard/sub-dealer-rate";
import { JIAD_DEALER_CODE_SUFFIX_MAP } from "@/lib/parse-claims";
import { SUB_DEALER_SHEET_ID, normalizeVin, normalizeWorkOrder } from "@/lib/sub-dealer-wips";

/**
 * The Sub-Dealer Analytics page: the sub-dealer's live Google Sheet (Claims and Free Service tabs) set beside what the dealer got
 * on the claims batch for the same work orders. A sheet row and a batch claim belong together when the base work order
 * number AND the VIN match (see src/lib/sub-dealer-wips.ts).
 *
 * Money: "Labor Approved (SAR, VAT incl.)" in the sheet is what came to the sub-dealer (riyals); "Adjusted Claim TOL." on the batch is
 * what the dealer is paid for the claim, in US dollars (converted at 3.75); the difference is the dealer's revenue.
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
  /** When the sub-dealer opened the claim (with the time), milliseconds - null when the sheet has no usable date. */
  createdAt: number | null;
  /** The stages after it, from the sheet's stage columns (milliseconds, same clock as createdAt); null until reached or when the sheet has no such column. */
  stages: SdStages;
};

/** sub-dealer -> dealer (read) -> parts reply -> parts arrived -> repair completed -> closed. */
export type SdStages = { dealerReceived: number | null; partsReplied: number | null; partsArrived: number | null; repairDone: number | null; closed: number | null };

/**
 * A free service request. `invoiced` is what the dealer invoiced on that work order to account I660 (free service for the
 * customer) and `paid` what it invoiced to I1855 (the amount paid to the sub-dealer) - both from the Warranty Invoicing report
 * (KH9 labor + MG5 parts lines, riyals), matched on work order and VIN. null = no such line invoiced yet.
 */
export type SdFree = {
  id: string;
  status: string;
  branch: string;
  workOrder: string;
  subWorkOrder: string;
  vin: string;
  service: string;
  approved: number | null;
  created: string | null;
  month: string | null;
  invoiced: number | null;
  paid: number | null;
};

/** What the dealer's claims batch holds for one key (work order + VIN): all its follow-up job cards together. */
/** The batch is in US dollars; `adjusted` / `settled` are the same amounts in riyals (x 3.75), the currency of the sub-dealer sheet. */
export type SdBatch = { claimNumbers: string[]; statuses: string[]; adjusted: number; settled: number; adjustedUsd: number; settledUsd: number; /** The parts on those claims, named as in the batch (not as typed in the sub-dealer's sheet). */ parts: { name: string; qty: number }[] };

export type SubDealerDashboard =
  | {
      status: "ok";
      updatedAt: string;
      /** The sheet has the "Labor Approved (SAR, VAT incl.)" column. */
      hasLaborApproved: boolean;
      /** The Claims tab has at least one stage time column (Dealer Received At ... Closed At) - the lead-time chain needs them. */
      hasStageTimes: boolean;
      /** What the first step ends at: the dealer's approve / reject click ("Dealer Decision At"), or only the time the system logged the claim as received (set automatically, about a minute after it is opened). */
      dealerStep: "decision" | "received" | null;
      /** The last invoice date in the Warranty Invoicing report (free service invoices after it are not in yet). */
      invoicingThrough: string | null;
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

const fixMonth = (t: string) => t.replace(/\bSept\b/i, "Sep");

/** "11 Nov 2026, 10:51", "2026-11-11 10:51" or a Sheets serial number (with its time) -> milliseconds, all on one clock (only differences are used). */
function timeMs(v: unknown): number | null {
  if (typeof v === "number") return v > 20_000 && v < 80_000 ? Date.UTC(1899, 11, 30) + Math.round(v * 86_400_000) : null;
  const t = fixMonth(text(v));
  if (!t) return null;
  let ms: number;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    // ISO-like ("2026-11-11", "2026-11-11 10:51", "2026-11-11T10:51:00Z"): no zone given means the sheet's own clock, read as UTC.
    const iso = t.replace(" ", "T");
    ms = Date.parse(/Z$|[+-]\d{2}:?\d{2}$/.test(iso) || !iso.includes("T") ? iso : `${iso}Z`);
  } else {
    ms = Date.parse(`${t} UTC`); // "11 Nov 2026, 10:51"
  }
  return Number.isNaN(ms) ? null : ms;
}

/** "11 Nov 2026, 10:51", "2026-11-11" or a Sheets serial number -> "2026-11-11". */
function isoDay(v: unknown): string | null {
  if (typeof v === "number" && v > 20_000 && v < 80_000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000).toISOString().slice(0, 10);
  const t = text(v);
  if (!t) return null;
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ms = Date.parse(`${fixMonth(t)} UTC`);
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

type Parsed = { hasLaborApproved: boolean; hasStageTimes: boolean; dealerStep: "decision" | "received" | null; claims: SdClaim[]; free: SdFree[] };

function parseSheet(claimRows: unknown[][] | null, freeRows: unknown[][] | null): Parsed {
  const claims: SdClaim[] = [];
  let hasLaborApproved = false;
  let hasStageTimes = false;
  let dealerStep: "decision" | "received" | null = null;
  if (claimRows && claimRows.length) {
    const h = claimRows[0].map(norm);
    const col = (name: string) => h.indexOf(name);
    const approvedCol = h.findIndex((x) => x.startsWith("labor approved"));
    hasLaborApproved = approvedCol !== -1;
    // Stage time columns (each is a date and time); the first header that matches one of its names is used.
    const stageCol = (names: string[]) => h.findIndex((x) => names.includes(x));
    const stageCols = {
      // The dealer's approve / reject time is what the first step should end at; the "received" time is only a fallback.
      dealerReceived: (() => {
        const decision = stageCol(["dealer decision at", "dealer decision", "dealer approved or rejected at", "dealer approved at", "dealer rejected at", "dealer reviewed at", "decision at", "decision date", "approved at", "approved or rejected at"]);
        if (decision !== -1) {
          dealerStep = "decision";
          return decision;
        }
        const received = stageCol(["dealer received at", "dealer received", "received by dealer at", "dealer read at"]);
        if (received !== -1) dealerStep = "received";
        return received;
      })(),
      partsReplied: stageCol(["parts replied at", "parts replied", "parts reply at", "parts response at"]),
      partsArrived: stageCol(["parts arrived at", "parts arrival at", "parts arrived date"]),
      repairDone: stageCol(["repair completed at", "repair completed", "repair done at", "after repair at", "repaired at"]),
      closed: stageCol(["closed at", "closed date", "close date", "closed on"]),
    };
    hasStageTimes = Object.values(stageCols).some((c) => c !== -1);
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
        createdAt: timeMs(r[created]),
        stages: {
          dealerReceived: stageCols.dealerReceived === -1 ? null : timeMs(r[stageCols.dealerReceived]),
          partsReplied: stageCols.partsReplied === -1 ? null : timeMs(r[stageCols.partsReplied]),
          partsArrived: stageCols.partsArrived === -1 ? null : timeMs(r[stageCols.partsArrived]),
          repairDone: stageCols.repairDone === -1 ? null : timeMs(r[stageCols.repairDone]),
          closed: stageCols.closed === -1 ? null : timeMs(r[stageCols.closed]),
        },
      });
    }
  }
  const free: SdFree[] = [];
  if (freeRows && freeRows.length) {
    const h = freeRows[0].map(norm);
    const col = (name: string) => h.indexOf(name);
    const [id, status, branch, dealerWo, subWo, vin, service, approved, created] = ["free service id", "status", "branch", "work order (dealer)", "work order (sub-dealer)", "vin", "service requested", "approved amount", "creation date"].map(col);
    for (const r of freeRows.slice(1)) {
      if (!text(r[id])) continue;
      const day = isoDay(r[created]);
      free.push({
        id: text(r[id]),
        status: text(r[status]) || "unknown",
        branch: text(r[branch]) || "Sub-dealer",
        workOrder: normalizeWorkOrder(r[dealerWo]) || text(r[dealerWo]),
        subWorkOrder: subWo === -1 ? "" : text(r[subWo]),
        vin: vin === -1 ? "" : normalizeVin(r[vin]),
        service: text(r[service]),
        approved: approved === -1 ? null : money(r[approved]),
        created: day,
        month: day ? day.slice(0, 7) : null,
        invoiced: null,
        paid: null,
      });
    }
  }
  return { hasLaborApproved, hasStageTimes, dealerStep, claims, free };
}

/** The sheet is read at most every two minutes; a failed read is never cached. */
const readSheet = unstable_cache(
  async (): Promise<Parsed> => {
    const [claimRows, freeRows] = await Promise.all([readSheetNamed(SUB_DEALER_SHEET_ID, "Claims"), readSheetNamed(SUB_DEALER_SHEET_ID, "Free Service")]);
    if (!claimRows) throw new Error('The sub-dealer sheet has no "Claims" tab.');
    return parseSheet(claimRows, freeRows);
  },
  ["sub-dealer-sheet-v3"],
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
    const [{ data: settle }, { data: vins }, { data: partLines }] = await Promise.all([
      admin.from("self_audit_claim_settlement").select("claim_id, claim_number, work_order_no, status, adjusted, settle_vat").in("claim_id", chunk),
      admin.from("self_audit_claims").select("id, vin").in("id", chunk),
      admin.from("self_audit_claim_parts").select("claim_id, part_name, quantity").in("claim_id", chunk),
    ]);
    const vinOf = new Map((vins ?? []).map((c) => [c.id, c.vin]));
    const keyOfClaim = new Map<string, string>();
    for (const s of settle ?? []) {
      const key = keyOf(s.work_order_no ?? "", vinOf.get(s.claim_id) ?? "");
      if (!key) continue;
      keyOfClaim.set(s.claim_id, key);
      const b = (batch[key] ??= { claimNumbers: [], statuses: [], adjusted: 0, settled: 0, adjustedUsd: 0, settledUsd: 0, parts: [] });
      if (s.claim_number) b.claimNumbers.push(s.claim_number);
      if (s.status && !b.statuses.includes(s.status)) b.statuses.push(s.status);
      // The batch amounts are in US dollars: kept as they are and converted to riyals at the fixed rate.
      b.adjustedUsd += Number(s.adjusted ?? 0);
      b.settledUsd += Number(s.settle_vat ?? 0);
      b.adjusted = b.adjustedUsd * SAR_PER_USD;
      b.settled = b.settledUsd * SAR_PER_USD;
    }
    // The parts of those claims, with the batch's own part names.
    for (const l of partLines ?? []) {
      const key = keyOfClaim.get(l.claim_id);
      const name = l.part_name?.trim();
      if (!key || !name) continue;
      const parts = batch[key].parts;
      const qty = Number(l.quantity ?? 1) || 1;
      const hit = parts.find((p) => p.name === name);
      if (hit) hit.qty += qty;
      else parts.push({ name, qty });
    }
  }
  return batch;
}

const accountNo = (code: string) => code.trim().toUpperCase().replace(/^[A-Z]+/, "").replace(/^0+/, "");

/**
 * What the Warranty Invoicing report holds for each free service work order: the lines invoiced to account I660 (free service
 * for the customer) and to I1855 (goodwill - what is paid to the sub-dealer), labor (KH9) and parts (MG5) together. A line
 * belongs to a request when its branch, work order number and VIN all match.
 */
async function addInvoicing(free: SdFree[]): Promise<string | null> {
  const admin = createAdminClient();
  const { data: last } = await admin.from("self_audit_invoicing_detail").select("invoice_date").order("invoice_date", { ascending: false, nullsFirst: false }).limit(1);
  const through = last?.[0]?.invoice_date ?? null;
  // dealer code of the request's branch (HER -> A7) and its WIP number
  const wanted = free.flatMap((f) => {
    const m = f.workOrder.match(/^([A-Z]{2,4})-(\d+)/);
    const dealer = m ? Object.entries(JIAD_DEALER_CODE_SUFFIX_MAP).find(([, code]) => code === m[1])?.[0] : undefined;
    return m && dealer && f.vin ? [{ f, dealer, wip: m[2] }] : [];
  });
  if (!wanted.length) return through;
  const numbers = [...new Set(wanted.map((w) => w.wip))];
  const { data } = await admin
    .from("self_audit_invoicing_detail")
    .select("branch, wip, vin, account_code, amount")
    .or(numbers.map((n) => `wip.like.${n}*`).join(","))
    .in("account_code", ["I0000660", "I0001855", "I660", "I1855"]);
  for (const w of wanted) {
    let i660: number | null = null;
    let i1855: number | null = null;
    for (const r of data ?? []) {
      if (r.branch !== w.dealer || normalizeVin(r.vin) !== w.f.vin || r.wip.trim().replace(/-\d+$/, "") !== w.wip) continue;
      const acc = accountNo(r.account_code);
      if (acc === "660") i660 = (i660 ?? 0) + Number(r.amount);
      else if (acc === "1855") i1855 = (i1855 ?? 0) + Number(r.amount);
    }
    w.f.invoiced = i660;
    w.f.paid = i1855;
  }
  return through;
}

export async function loadSubDealerDashboard(): Promise<SubDealerDashboard> {
  if (!(await getSheetsStatus())) return { status: "not_connected" };
  try {
    const [parsed, batch] = await Promise.all([readSheet(), loadBatch()]);
    // The cached sheet rows are shared: the invoicing amounts go on copies.
    const free = parsed.free.map((f) => ({ ...f }));
    const invoicingThrough = await addInvoicing(free).catch(() => null);
    return {
      status: "ok",
      updatedAt: new Date().toISOString(),
      hasLaborApproved: parsed.hasLaborApproved,
      hasStageTimes: parsed.hasStageTimes,
      dealerStep: parsed.dealerStep,
      invoicingThrough,
      claims: parsed.claims,
      free,
      batch,
      branches: [...new Set([...parsed.claims, ...parsed.free].map((c) => c.branch))].sort(),
      months: [...new Set([...parsed.claims, ...parsed.free].map((c) => c.month).filter((m): m is string => !!m))].sort(),
    };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Could not read the sub-dealer sheet." };
  }
}
