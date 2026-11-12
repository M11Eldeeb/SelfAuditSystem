import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { JIAD_DEALER_CODE_SUFFIX_MAP } from "@/lib/parse-claims";
import { vorByWip } from "@/lib/vor/sheet";
import { agreementOpen, loadCourtesy, wipKey } from "@/lib/courtesy/sheet";
import { branchResolver } from "@/lib/courtesy/branches";
import { STATUS_LABEL as INQUIRY_STATUS, inquiryLabel, type InquiryStatus } from "@/lib/technical-inquiries";
import { purposeLabel } from "@/lib/qc/constants";

/**
 * Query: one search box for everything the portal knows about a vehicle / job. The manager types a WIP number, a VIN,
 * a plate or a claim number (WSA…, TC-…, QC-…, TI-…); it is turned into the job (branch + WIP) and the vehicle (VIN), and
 * every source is read at once: open WIP, warranty claims, complaints, VOR, courtesy cars, rejected claims, technician
 * claims, technical inquiries and verification codes, quality control, invoicing, scrap, sub-dealer claims.
 * Officers see every branch; a branch admin (or service manager) only his own. No customer data is shown.
 */

export type QuerySection = {
  key: string;
  title: string;
  /** What the rows are, for the header ("3 claims"). */
  noun: [string, string];
  columns: string[];
  rows: (string | null)[][];
  /** Where each row opens (same order as rows), when it has a page in the portal. */
  links?: (string | null)[];
  /** Highlighted figures at the top of the card. */
  stats?: { label: string; value: string; tone?: "good" | "bad" | "warn" }[];
  note?: string;
};

export type QueryResult = {
  query: string;
  /** What was understood ("WIP 12345 - Jeddah Heraa", "VIN LSJ…"). */
  understood?: string;
  /** The WIP number exists in more than one branch: the manager picks one. */
  chooseBranch?: { id: string; name: string; seenIn: string[] }[];
  vehicle?: { label: string; value: string }[];
  sections: QuerySection[];
  error?: string;
};

type Db = SupabaseClient;
const NONE = "00000000-0000-0000-0000-000000000000";
const day = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : null);
const usd = (n: number | null | undefined) => (n == null ? null : `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
const sar = (n: number) => `SAR ${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const vinOf = (v: string | null | undefined) => {
  const s = (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length >= 11 ? s : null;
};
const plateKey = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

type Parsed =
  | { kind: "wip"; digits: string; code?: string }
  | { kind: "vin"; vin: string }
  | { kind: "plate"; plate: string }
  | { kind: "claim"; claimNo: string }
  | { kind: "tc"; no: string }
  | { kind: "qc"; no: string }
  | { kind: "ti"; no: string };

function parse(input: string): Parsed | null {
  const s = input.trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^TC-?(\d{1,6})$/))) return { kind: "tc", no: m[1] };
  if ((m = s.match(/^QC-?(\d{1,6})$/))) return { kind: "qc", no: m[1] };
  if ((m = s.match(/^TI-?(\d{1,6})$/))) return { kind: "ti", no: m[1] };
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(s) && /\d/.test(s) && /[A-Z]/.test(s)) return { kind: "vin", vin: s };
  if (/^W[A-Z0-9]{9,20}$/.test(s) && /\d{6}/.test(s)) return { kind: "claim", claimNo: s };
  if ((m = s.match(/^([A-Z]{3})-?(\d{3,7})(?:-\d{1,2})?$/))) return { kind: "wip", code: m[1], digits: m[2].replace(/^0+/, "") };
  if ((m = s.match(/^(\d{3,7})$/))) return { kind: "wip", digits: m[1].replace(/^0+/, "") };
  if (/^\d{1,4}[A-Z]{3}$/.test(s) || /^[A-Z]{3}\d{1,4}$/.test(s)) return { kind: "plate", plate: s };
  return null;
}

type Branch = { id: string; name: string; code: string };

/**
 * Claims (settlement rows) whose work order has this WIP number ("RSS-37645", "RSS-37645-1"), optionally of one branch.
 * Uses the indexed wip_digits column; until that column exists (migration 0177) it reads the work orders instead.
 */
async function claimsOfWip(admin: Db, digits: string, branchId: string | null): Promise<{ claim_id: string; branch_id: string }[]> {
  let q = admin.from("self_audit_claim_settlement").select("claim_id, branch_id").eq("wip_digits", digits).limit(200);
  if (branchId) q = q.eq("branch_id", branchId);
  const fast = await q;
  if (!fast.error) return (fast.data ?? []) as { claim_id: string; branch_id: string }[];
  let slow = admin.from("self_audit_claim_settlement").select("claim_id, branch_id").or(`work_order_no.ilike.%-${digits},work_order_no.ilike.%-${digits}-*`).limit(200);
  if (branchId) slow = slow.eq("branch_id", branchId);
  return ((await slow).data ?? []) as { claim_id: string; branch_id: string }[];
}

/** Everything known about `input` (for `branchId` when the WIP number exists in several branches). */
export async function runVehicleQuery(user: CurrentUser, input: string, branchId: string | null, base: string): Promise<QueryResult> {
  const query = input.trim().slice(0, 40);
  const p = parse(query);
  if (!p) return { query, sections: [], error: "Enter a WIP number, a VIN, a plate or a claim number (WSA…, TC-…, QC-…, TI-…)." };
  const admin = createAdminClient() as unknown as Db;
  const own = user.role === "officer" || user.view_all ? null : (user.branch_id ?? NONE);
  const { data: branchRows } = await admin.from("self_audit_branches").select("id, name, code");
  const branches: Branch[] = ((branchRows ?? []) as { id: string; name: string; code: string | null }[]).map((b) => ({ id: b.id, name: b.name, code: (b.code ?? "").toUpperCase() }));
  const byId = new Map(branches.map((b) => [b.id, b]));
  const byCode = new Map(branches.map((b) => [b.code, b]));
  const dealerOf = (code: string) => Object.entries(JIAD_DEALER_CODE_SUFFIX_MAP).find(([, c]) => c === code)?.[0] ?? null;
  const branchOfDealer = (dealer: string) => byCode.get(JIAD_DEALER_CODE_SUFFIX_MAP[dealer] ?? "") ?? null;

  // ---------------------------------------------------------------- 1. the job (branch + WIP) and the vehicle (VINs)
  let digits: string | null = null;
  let branch: Branch | null = null;
  const vins = new Set<string>();
  const plates = new Set<string>();
  const addVin = (v: string | null | undefined) => {
    const x = vinOf(v);
    if (x) vins.add(x);
  };
  const setJob = (workOrder: string | null | undefined, branchIdOf?: string | null) => {
    const m = (workOrder ?? "").toUpperCase().match(/^([A-Z]{3})-?(\d{3,7})/);
    if (!m) return;
    digits = m[2].replace(/^0+/, "");
    branch = (branchIdOf ? byId.get(branchIdOf) : null) ?? byCode.get(m[1]) ?? null;
  };

  if (p.kind === "claim") {
    const { data } = await admin.from("self_audit_claims").select("id, branch_id, work_order_no, vin").eq("claim_number", p.claimNo).limit(1);
    const c = (data ?? [])[0] as { branch_id: string; work_order_no: string | null; vin: string | null } | undefined;
    if (!c) return { query, sections: [], error: `No warranty claim ${p.claimNo}.` };
    setJob(c.work_order_no, c.branch_id);
    addVin(c.vin);
  } else if (p.kind === "tc" || p.kind === "qc") {
    const table = p.kind === "tc" ? "self_audit_tech_claims" : "self_audit_qc_checks";
    const col = p.kind === "tc" ? "claim_no" : "qc_no";
    const label = `${p.kind.toUpperCase()}-${p.no.padStart(6, "0")}`;
    const { data } = await admin.from(table).select(p.kind === "tc" ? "branch_id, work_order, vin" : "branch_id, wip_no, vin").eq(col, label).limit(1);
    const r = (data ?? [])[0] as { branch_id: string; work_order?: string; wip_no?: string; vin: string | null } | undefined;
    if (!r) return { query, sections: [], error: `No ${label}.` };
    setJob(r.work_order ?? r.wip_no, r.branch_id);
    addVin(r.vin);
  } else if (p.kind === "ti") {
    const { data } = await admin.from("self_audit_technical_inquiries").select("branch_id, work_order_no, vin").eq("inquiry_no", Number(p.no)).limit(1);
    const r = (data ?? [])[0] as { branch_id: string; work_order_no: string; vin: string | null } | undefined;
    if (!r) return { query, sections: [], error: `No ${inquiryLabel(Number(p.no))}.` };
    setJob(r.work_order_no, r.branch_id);
    addVin(r.vin);
  } else if (p.kind === "vin") {
    vins.add(p.vin);
  } else if (p.kind === "plate") {
    plates.add(p.plate);
    const { data } = await admin.from("self_audit_open_wips").select("branch_id, wip_no, vin, registration").limit(3000);
    const hit = ((data ?? []) as { branch_id: string; wip_no: string; vin: string | null; registration: string | null }[]).filter((r) => plateKey(r.registration) === p.plate);
    for (const h of hit) addVin(h.vin);
    if (hit.length === 1) {
      digits = String(hit[0].wip_no).replace(/\D/g, "").replace(/^0+/, "");
      branch = byId.get(hit[0].branch_id) ?? null;
    }
  } else {
    // A WIP number: in which branches does it exist?
    digits = p.digits;
    if (p.code) branch = byCode.get(p.code) ?? null;
    if (!branch && branchId) branch = byId.get(branchId) ?? null;
    if (!branch) {
      const seen = new Map<string, Set<string>>();
      const mark = (id: string | null | undefined, where: string) => {
        if (!id || (own && id !== own)) return;
        if (!seen.has(id)) seen.set(id, new Set());
        seen.get(id)!.add(where);
      };
      const like = `%-${p.digits}`;
      const [ow, cl, tc, rj, ti, qc, inv] = await Promise.all([
        admin.from("self_audit_open_wips").select("branch_id").eq("wip_no", p.digits),
        claimsOfWip(admin, p.digits, own).then((data) => ({ data })),
        admin.from("self_audit_tech_claims").select("branch_id").ilike("work_order", like),
        admin.from("self_audit_rejected_claims").select("branch_id").ilike("work_order_no", like),
        admin.from("self_audit_technical_inquiries").select("branch_id").ilike("work_order_no", like),
        admin.from("self_audit_qc_checks").select("branch_id").ilike("wip_no", like),
        admin.from("self_audit_invoicing_detail").select("branch").eq("wip", p.digits).limit(200),
      ]);
      for (const r of (ow.data ?? []) as { branch_id: string }[]) mark(r.branch_id, "Open WIPs");
      for (const r of (cl.data ?? []) as { branch_id: string }[]) mark(r.branch_id, "Warranty claims");
      for (const r of (tc.data ?? []) as { branch_id: string }[]) mark(r.branch_id, "Technician claims");
      for (const r of (rj.data ?? []) as { branch_id: string }[]) mark(r.branch_id, "Rejected claims");
      for (const r of (ti.data ?? []) as { branch_id: string }[]) mark(r.branch_id, "Technical inquiries");
      for (const r of (qc.data ?? []) as { branch_id: string }[]) mark(r.branch_id, "Quality control");
      for (const r of (inv.data ?? []) as { branch: string }[]) mark(branchOfDealer(r.branch)?.id, "Invoicing");
      if (own) branch = byId.get(own) ?? null;
      else if (seen.size === 1) branch = byId.get([...seen.keys()][0]) ?? null;
      else if (seen.size > 1)
        return {
          query,
          understood: `WIP ${p.digits}`,
          chooseBranch: [...seen.entries()].map(([id, w]) => ({ id, name: byId.get(id)?.name ?? "—", seenIn: [...w] })).sort((a, b) => a.name.localeCompare(b.name)),
          sections: [],
        };
    }
  }
  if (own && branch && (branch as Branch).id !== own) return { query, sections: [], error: "This job belongs to another branch." };

  const b = branch as Branch | null;
  const wo = b && digits ? `${b.code}-${digits}` : null;
  const dealer = b ? dealerOf(b.code) : null;
  type Q = ReturnType<ReturnType<Db["from"]>["select"]>;
  const scoped = (q: Q): Q => (own ? q.eq("branch_id", own) : q);

  // VINs of the job (from the reports that know it).
  const jobClaimIds = wo && digits ? (await claimsOfWip(admin, digits, b!.id)).map((c) => c.claim_id) : [];
  if (wo && digits) {
    const [ow, cl, ti, qc, inv] = await Promise.all([
      admin.from("self_audit_open_wips").select("vin, registration").eq("wip_no", digits).eq("branch_id", b!.id),
      jobClaimIds.length ? admin.from("self_audit_claims").select("vin").in("id", jobClaimIds.slice(0, 100)) : Promise.resolve({ data: [] }),
      admin.from("self_audit_technical_inquiries").select("vin, plate_number").eq("work_order_no", wo),
      admin.from("self_audit_qc_checks").select("vin").eq("wip_no", wo),
      dealer ? admin.from("self_audit_invoicing_detail").select("vin").eq("wip", digits).eq("branch", dealer).limit(50) : Promise.resolve({ data: [] }),
    ]);
    for (const r of [...(ow.data ?? []), ...(cl.data ?? []), ...(ti.data ?? []), ...(qc.data ?? []), ...(inv.data ?? [])] as { vin?: string | null; registration?: string | null; plate_number?: string | null }[]) {
      addVin(r.vin);
      if (r.registration) plates.add(plateKey(r.registration));
      if (r.plate_number) plates.add(plateKey(r.plate_number));
    }
  }
  const vinList = [...vins].slice(0, 5);
  if (!wo && !vinList.length && !plates.size) return { query, sections: [], error: "Nothing found for this search." };

  // ---------------------------------------------------------------- 2. every source at once
  const [openWip, claims, complaints, rejected, techClaims, inquiries, codes, qcs, invoicing, scrap, subDealer, vor, courtesy] = await Promise.all([
    wo ? admin.from("self_audit_open_wips").select("*").eq("wip_no", digits).eq("branch_id", b!.id) : vinList.length ? scoped(admin.from("self_audit_open_wips").select("*")).in("vin", vinList) : Promise.resolve({ data: [] }),
    (async () => {
      // This job's claims and every claim of the same vehicle - read by claim id (the table's key).
      const byVin = vinList.length ? (((await admin.from("self_audit_claims").select("id").in("vin", vinList).limit(300)).data ?? []) as { id: string }[]).map((r) => r.id) : [];
      const ids = [...new Set([...jobClaimIds, ...byVin])].slice(0, 300);
      if (!ids.length) return { data: [] };
      return scoped(admin.from("self_audit_claim_settlement").select("claim_id, claim_number, work_order_no, status, claim_amount, adjusted, repair_end, main_part_name, labor_code, prior_approval, return_times_dealer, branch_id")).in("claim_id", ids).order("repair_end", { ascending: false }).limit(300);
    })(),
    vinList.length ? scoped(admin.from("self_audit_complaints").select("complaint_no, created_on, status, category, subcategory, branch_label, branch_id, resolved_on")).in("vin", vinList).order("created_on", { ascending: false }) : Promise.resolve({ data: [] }),
    wo ? scoped(admin.from("self_audit_rejected_claims").select("id, work_order_no, claim_no, rejection_date, reason, branch_id")).eq("work_order_no", wo) : Promise.resolve({ data: [] }),
    wo || vinList.length
      ? scoped(admin.from("self_audit_tech_claims").select("id, claim_no, work_order, status, technician_name, submitted_at, created_at, branch_id")).or([...(wo ? [`work_order.eq.${wo}`] : []), ...(vinList.length ? [`vin.in.(${vinList.join(",")})`] : [])].join(","))
      : Promise.resolve({ data: [] }),
    wo || vinList.length
      ? scoped(admin.from("self_audit_technical_inquiries").select("id, inquiry_no, work_order_no, status, system, created_at, branch_id")).or([...(wo ? [`work_order_no.eq.${wo}`] : []), ...(vinList.length ? [`vin.in.(${vinList.join(",")})`] : [])].join(","))
      : Promise.resolve({ data: [] }),
    vinList.length ? scoped(admin.from("self_audit_verification_requests").select("request_no, module_name, status, created_at, branch_id")).in("vin", vinList).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    wo || vinList.length
      ? scoped(admin.from("self_audit_qc_checks").select("id, qc_no, wip_no, purpose, status, attempts, created_at, branch_id")).or([...(wo ? [`wip_no.eq.${wo}`] : []), ...(vinList.length ? [`vin.in.(${vinList.join(",")})`] : [])].join(","))
      : Promise.resolve({ data: [] }),
    digits && dealer ? admin.from("self_audit_invoicing_detail").select("invoice_no, invoice_date, sales_type, account_name, source, amount").eq("wip", digits).eq("branch", dealer).limit(500) : Promise.resolve({ data: [] }),
    wo ? scoped(admin.from("self_audit_scrap_requests").select("work_order_no, main_labor_name, settlement_date, status, branch_id")).eq("work_order_no", wo) : Promise.resolve({ data: [] }),
    vinList.length ? admin.from("sub_dealer_claims").select("claim_number, work_order_number, status, created_at, branch_id").in("vin", vinList) : Promise.resolve({ data: [] }),
    digits ? vorByWip().catch(() => null) : Promise.resolve(null),
    digits || plates.size ? loadCourtesy().catch(() => null) : Promise.resolve(null),
  ]);
  const name = (id: string | null | undefined) => (id ? (byId.get(id)?.name ?? "—") : "—");
  const sections: QuerySection[] = [];

  // Vehicle facts
  type OpenWip = { wip_no: string; branch_id: string; model: string | null; registration: string | null; mileage: string | null; vin: string | null; received: string | null; due_out: string | null; wip_status: string | null; operator: string | null; first_seen: string | null; job: string | null; parts_status: string | null };
  const ow = (openWip.data ?? []) as OpenWip[];
  const vehicle: { label: string; value: string }[] = [];
  if (vinList.length) vehicle.push({ label: "VIN", value: vinList.join(", ") });
  const o = ow[0];
  if (o?.model) vehicle.push({ label: "Model", value: o.model });
  if (o?.registration || plates.size) vehicle.push({ label: "Plate", value: o?.registration ?? [...plates][0] });
  if (o?.mileage) vehicle.push({ label: "Mileage", value: `${Number(String(o.mileage).replace(/\D/g, "")).toLocaleString("en-US")} km` });
  if (b) vehicle.push({ label: "Branch", value: b.name });
  if (wo) vehicle.push({ label: "WIP", value: wo });

  if (ow.length) {
    const today = Date.now();
    sections.push({
      key: "open-wip",
      title: "Open WIP",
      noun: ["open WIP", "open WIPs"],
      columns: ["WIP", "Branch", "Received", "Due out", "Status", "Parts", "Advisor", "Days open"],
      rows: ow.map((w) => [`${byId.get(w.branch_id)?.code ?? ""}-${w.wip_no}`, name(w.branch_id), day(w.received), day(w.due_out), w.wip_status, w.parts_status, w.operator, w.first_seen ? String(Math.max(0, Math.round((today - Date.parse(w.first_seen)) / 86_400_000))) : null]),
      stats: [{ label: "Still open", value: "Yes", tone: "warn" }],
    });
  } else if (wo) {
    sections.push({ key: "open-wip", title: "Open WIP", noun: ["open WIP", "open WIPs"], columns: [], rows: [], note: "Not in the Open WIPs report (closed / invoiced, or not opened yet)." });
  }

  type Claim = { claim_id: string; claim_number: string; work_order_no: string | null; status: string | null; claim_amount: number | null; adjusted: number | null; repair_end: string | null; main_part_name: string | null; labor_code: string | null; prior_approval: string | null; return_times_dealer: number | null; branch_id: string };
  const cl = (claims.data ?? []) as Claim[];
  const total = cl.reduce((s, c) => s + Number(c.claim_amount ?? 0), 0);
  const paid = cl.reduce((s, c) => s + Number(c.adjusted ?? c.claim_amount ?? 0), 0);
  sections.push({
    key: "claims",
    title: "Warranty claims",
    noun: ["claim", "claims"],
    columns: ["Claim", "Work order", "Status", "Amount", "Adjusted", "Repair end", "Main part", "Prior approval", "Returned"],
    rows: cl.map((c) => [c.claim_number, c.work_order_no, c.status, usd(c.claim_amount), usd(c.adjusted), day(c.repair_end), c.main_part_name, c.prior_approval?.trim() || null, c.return_times_dealer ? `${c.return_times_dealer}×` : null]),
    stats: cl.length
      ? [
          { label: "Claimed", value: usd(total) ?? "—" },
          { label: "Accepted", value: usd(paid) ?? "—", tone: paid < total - 0.5 ? "warn" : "good" },
          ...(cl.some((c) => c.prior_approval?.trim()) ? [{ label: "Prior approval", value: String(cl.filter((c) => c.prior_approval?.trim()).length) }] : []),
        ]
      : undefined,
    note: vinList.length ? "This WIP and every earlier claim of the same vehicle." : undefined,
  });

  type Complaint = { complaint_no: string | null; created_on: string | null; status: string | null; category: string | null; subcategory: string | null; branch_label: string | null; resolved_on: string | null };
  const cp = (complaints.data ?? []) as Complaint[];
  sections.push({
    key: "complaints",
    title: "Complaints",
    noun: ["complaint", "complaints"],
    columns: ["Complaint", "Date", "Category", "Status", "Resolved", "Branch"],
    rows: cp.map((c) => [c.complaint_no, day(c.created_on), [c.category, c.subcategory].filter(Boolean).join(" · ") || null, c.status, day(c.resolved_on), c.branch_label]),
    stats: cp.length ? [{ label: "Open", value: String(cp.filter((c) => !c.resolved_on && !/clos|resolv/i.test(c.status ?? "")).length), tone: cp.some((c) => !c.resolved_on && !/clos|resolv/i.test(c.status ?? "")) ? "bad" : "good" }] : undefined,
    note: vinList.length ? undefined : "Complaints are matched by VIN - no VIN known for this job.",
  });

  // VOR (the VOR file, by WIP number; lines of other branches left out when the file says the branch)
  const resolve = await branchResolver();
  const vorLines = (vor && digits ? (vor.get(digits) ?? []) : []).filter((l) => !b || !l.branch || (resolve(l.branch)?.id ?? b.id) === b.id);
  sections.push({
    key: "vor",
    title: "VOR parts",
    noun: ["VOR line", "VOR lines"],
    columns: ["Part", "Description", "Qty", "Ordered", "ETA", "Status"],
    rows: vorLines.map((l) => [l.part, l.description, l.qty, l.orderDate, l.eta, l.status]),
    note: vor === null && digits ? "The VOR file could not be read right now." : undefined,
  });

  // Courtesy cars (agreements by WIP or plate; no customer columns)
  const cs = courtesy;
  const agreements: (string | null)[][] = [];
  let openCar = false;
  if (cs?.agreements) {
    const c = cs.cols.agreements;
    for (const r of cs.agreements.rows) {
      const byWip = digits && c.wip >= 0 && wipKey(r[c.wip] ?? "") === digits;
      const byPlate = plates.size && c.plate >= 0 && plates.has(plateKey(r[c.plate]));
      if (!byWip && !byPlate) continue;
      const rb = c.branch >= 0 ? resolve(r[c.branch] ?? "") : null;
      if (b && rb && rb.id !== b.id) continue;
      if (own && rb && rb.id !== own) continue;
      const isOpen = agreementOpen(r, c);
      openCar ||= isOpen;
      agreements.push([c.agreement >= 0 ? r[c.agreement] || null : null, c.wip >= 0 ? r[c.wip] || null : null, c.plate >= 0 ? r[c.plate] || null : null, c.out >= 0 ? r[c.out] || null : null, c.back >= 0 ? r[c.back] || null : null, isOpen ? "With the customer" : "Returned", rb?.name ?? null]);
    }
  }
  sections.push({
    key: "courtesy",
    title: "Courtesy cars",
    noun: ["agreement", "agreements"],
    columns: ["Agreement", "WIP", "Courtesy car", "Out", "Back", "Now", "Branch"],
    rows: agreements,
    stats: agreements.length ? [{ label: "Car out now", value: openCar ? "Yes" : "No", tone: openCar ? "warn" : "good" }] : undefined,
  });

  type Rejected = { id: string; work_order_no: string; claim_no: string | null; rejection_date: string | null; reason: string | null; branch_id: string };
  const rj = (rejected.data ?? []) as Rejected[];
  sections.push({
    key: "rejected",
    title: "Rejected claims",
    noun: ["rejected claim", "rejected claims"],
    columns: ["Work order", "Claim", "Rejected on", "Reason"],
    rows: rj.map((r) => [r.work_order_no, r.claim_no, day(r.rejection_date), r.reason]),
    links: rj.map((r) => `${base}/rejected-claims/${r.id}`),
  });

  const TC_STATUS: Record<string, string> = { uploading: "Draft", submitted: "Waiting for review", returned: "Returned to technician", approved: "Approved", rejected: "Rejected" };
  type Tc = { id: string; claim_no: string; work_order: string; status: string; technician_name: string; submitted_at: string | null; created_at: string };
  const tc = ((techClaims.data ?? []) as Tc[]).filter((t) => t.status !== "uploading");
  sections.push({
    key: "technician-claims",
    title: "Technician claims",
    noun: ["technician claim", "technician claims"],
    columns: ["Claim", "Work order", "Technician", "Status", "Sent"],
    rows: tc.map((t) => [t.claim_no, t.work_order, t.technician_name, TC_STATUS[t.status] ?? t.status, day(t.submitted_at ?? t.created_at)]),
    links: tc.map((t) => `${base}/technician-claims/${t.id}`),
  });

  type Ti = { id: string; inquiry_no: number; work_order_no: string; status: string; system: string | null; created_at: string };
  const ti = (inquiries.data ?? []) as Ti[];
  type Code = { request_no: number; module_name: string | null; status: string; created_at: string };
  const vc = (codes.data ?? []) as Code[];
  sections.push({
    key: "inquiries",
    title: "Technical inquiries & verification codes",
    noun: ["case", "cases"],
    columns: ["Case", "Work order / module", "Status", "Date"],
    rows: [
      ...ti.map((t) => [inquiryLabel(t.inquiry_no), t.work_order_no, INQUIRY_STATUS[t.status as InquiryStatus] ?? t.status, day(t.created_at)]),
      ...vc.map((c) => [`Code request #${c.request_no}`, c.module_name, c.status, day(c.created_at)]),
    ],
    links: [...ti.map((t) => `${base}/technical-inquiries/${t.id}`), ...vc.map(() => null)],
  });

  type Qc = { id: string; qc_no: string; wip_no: string; purpose: string; status: string; attempts: number; created_at: string };
  const qc = (qcs.data ?? []) as Qc[];
  const QC_STATUS: Record<string, string> = { failed: "Failed - waiting for retest", passed: "Passed", closed: "Closed as failed" };
  sections.push({
    key: "quality",
    title: "Quality control",
    noun: ["QC", "QCs"],
    columns: ["QC", "WIP", "Purpose", "Result", "Tests", "Date"],
    rows: qc.map((q) => [q.qc_no, q.wip_no, purposeLabel(q.purpose), QC_STATUS[q.status] ?? q.status, String(q.attempts), day(q.created_at)]),
    links: qc.map((q) => `${base === "/admin" ? "/admin" : "/audit"}/quality-control/${q.id}`),
    stats: qc.length ? [{ label: "Waiting for retest", value: String(qc.filter((q) => q.status === "failed").length), tone: qc.some((q) => q.status === "failed") ? "bad" : "good" }] : undefined,
  });

  // Invoicing (labor KH9 + parts MG5), one row per invoice.
  type Inv = { invoice_no: string | null; invoice_date: string | null; sales_type: string | null; account_name: string | null; source: string; amount: number | null };
  const invRows = (invoicing.data ?? []) as Inv[];
  const byInvoice = new Map<string, { date: string | null; type: string | null; account: string | null; labor: number; parts: number }>();
  for (const r of invRows) {
    const k = r.invoice_no ?? "—";
    const e = byInvoice.get(k) ?? { date: day(r.invoice_date), type: r.sales_type, account: r.account_name, labor: 0, parts: 0 };
    if (r.source === "labor") e.labor += Number(r.amount ?? 0);
    else e.parts += Number(r.amount ?? 0);
    byInvoice.set(k, e);
  }
  const invTotal = [...byInvoice.values()].reduce((s, e) => s + e.labor + e.parts, 0);
  sections.push({
    key: "invoicing",
    title: "Invoicing",
    noun: ["invoice", "invoices"],
    columns: ["Invoice", "Date", "Sales type", "Account", "Labor", "Parts", "Total"],
    rows: [...byInvoice.entries()].map(([no, e]) => [no, e.date, e.type, e.account, sar(e.labor), sar(e.parts), sar(e.labor + e.parts)]),
    stats: byInvoice.size ? [{ label: "Invoiced", value: sar(invTotal) }] : undefined,
    note: digits ? undefined : "Invoicing is matched by WIP number.",
  });

  type Scrap = { work_order_no: string; main_labor_name: string | null; settlement_date: string | null; status: string };
  const sc = (scrap.data ?? []) as Scrap[];
  sections.push({
    key: "scrap",
    title: "Scrap requests",
    noun: ["scrap request", "scrap requests"],
    columns: ["Work order", "Job", "Settled", "Status"],
    rows: sc.map((s) => [s.work_order_no, s.main_labor_name, day(s.settlement_date), s.status === "scrapped" ? "Scrapped" : "Kept - waiting"]),
  });

  type Sub = { claim_number: string; work_order_number: string | null; status: string; created_at: string };
  const sd = (subDealer.data ?? []) as Sub[];
  if (sd.length)
    sections.push({
      key: "sub-dealer",
      title: "Sub-dealer claims",
      noun: ["sub-dealer claim", "sub-dealer claims"],
      columns: ["Claim", "Work order", "Status", "Date"],
      rows: sd.map((s) => [s.claim_number, s.work_order_number, s.status.replace(/_/g, " "), day(s.created_at)]),
    });

  const understood = [wo ? `WIP ${wo}` : null, b && !wo ? b.name : null, vinList.length ? `VIN ${vinList[0]}${vinList.length > 1 ? ` (+${vinList.length - 1})` : ""}` : null].filter(Boolean).join(" · ");
  return { query, understood, vehicle, sections };
}
