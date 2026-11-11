import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSheetNamed } from "@/lib/google-sheets";

/**
 * Sub-dealer WIPs: Heraa (HER) work orders that are warranty job cards done for a sub-dealer. The sub-dealer's live Google
 * Sheet lists them in the column "Work Order (Dealer)" of its Claims and Free Service tabs. The list is copied into
 * self_audit_sub_dealer_wips every 30 minutes (/api/cron/sub-dealer-wips); those WIPs are marked "Sub-Dealer WIP" and
 * their claims are left out of the self audits and internal audits (see get_sub_dealer_claim_ids, migrations 0165-0168).
 * A WIP counts only when the base work order number AND the VIN match: the WIP counter restarts after 8000, so the same
 * number can come back for another car.
 */
export const SUB_DEALER_SHEET_ID = process.env.SUB_DEALER_SHEET_ID || "17aNXQXHJNn8Alo-3r2patbY1scw-EScbd9oyLfDD250";
export const SUB_DEALER_LABEL = "Sub-Dealer WIP";
const TABS = ["Claims", "Free Service"];
const BRANCH_CODE = "HER";

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The base work order number, the form the list and the matching use: "her-44846 ", "HER 44846", "44846" and the follow-up
 * job card "HER-44846-1" are all "HER-44846" (a WIP listed by the sub-dealer makes its "-1", "-2" job cards sub-dealer WIPs
 * too - keep in step with get_sub_dealer_claim_ids, migration 0166). "" when there is nothing to use.
 */
export function normalizeWorkOrder(v: unknown): string {
  const t = String(v ?? "").toUpperCase().replace(/\s+/g, "");
  if (!t) return "";
  return (/^\d/.test(t) ? `${BRANCH_CODE}-${t}` : t).replace(/^([A-Z]{2,4}-\d+)-\d+$/, "$1");
}

export const normalizeVin = (v: unknown): string => String(v ?? "").toUpperCase().replace(/\s+/g, "");

export type SubDealerList = {
  /** The base work order AND the VIN both match a sub-dealer entry (the WIP counter restarts after 8000, so a number alone is not enough). */
  match(workOrder: string | null | undefined, vin: string | null | undefined): boolean;
  /** Only the work order is listed (the VIN is not checked): narrows which rows need their VIN looked up. */
  hasWorkOrder(workOrder: string | null | undefined): boolean;
};

const emptyList: SubDealerList = { match: () => false, hasWorkOrder: () => false };

/** The sub-dealer list for marking WIPs and claims. Never throws: no list means no marks. */
export async function loadSubDealerList(): Promise<SubDealerList> {
  try {
    const keys = new Set<string>();
    const orders = new Set<string>();
    const admin = createAdminClient();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("self_audit_sub_dealer_wips").select("work_order, vin").range(from, from + 999);
      if (error) return emptyList;
      for (const r of data ?? []) {
        keys.add(`${r.work_order}|${r.vin}`);
        orders.add(r.work_order);
      }
      if ((data ?? []).length < 1000) break;
    }
    return {
      match: (workOrder, vin) => {
        const wo = normalizeWorkOrder(workOrder);
        const v = normalizeVin(vin);
        return !!wo && !!v && keys.has(`${wo}|${v}`);
      },
      hasWorkOrder: (workOrder) => {
        const wo = normalizeWorkOrder(workOrder);
        return !!wo && orders.has(wo);
      },
    };
  } catch {
    return emptyList;
  }
}

/** The open WIP report writes the bare number ("44846") with the branch on a separate column: put the branch code in front. */
export const wipWorkOrder = (branchCode: string | null | undefined, wip: string | null | undefined): string => {
  const w = String(wip ?? "").trim();
  return /^\d/.test(w) && branchCode ? `${branchCode}-${w}` : w;
};

/**
 * Of rows that carry a claim number and a work order but no VIN (the scrap lists), the claim numbers that are sub-dealer
 * WIPs. Only rows whose work order is listed get their VIN looked up.
 */
export async function subDealerClaimNumbers(supabase: SupabaseClient<Database>, list: SubDealerList, rows: { claim_number: string; work_order_no: string | null }[]): Promise<Set<string>> {
  const need = [...new Set(rows.filter((r) => list.hasWorkOrder(r.work_order_no)).map((r) => r.claim_number))];
  const workOrderOf = new Map(rows.map((r) => [r.claim_number, r.work_order_no]));
  const hits = new Set<string>();
  for (let i = 0; i < need.length; i += 200) {
    const { data } = await supabase.from("self_audit_claims").select("claim_number, vin").in("claim_number", need.slice(i, i + 200));
    for (const c of data ?? []) if (list.match(workOrderOf.get(c.claim_number), c.vin)) hits.add(c.claim_number);
  }
  return hits;
}

export type SubDealerSyncResult = { wips: number; removedAssignments: number; removedInternalClaims: number } | { error: string };

type SheetEntry = { workOrder: string; vin: string; tab: string; subDealerWo: string | null };

async function readWorkOrders(): Promise<{ list: Map<string, SheetEntry>; problems: string[] }> {
  const list = new Map<string, SheetEntry>();
  const problems: string[] = [];
  for (const tab of TABS) {
    const rows = await readSheetNamed(SUB_DEALER_SHEET_ID, tab);
    if (!rows) {
      problems.push(`The sheet has no "${tab}" tab.`);
      continue;
    }
    const header = (rows[0] ?? []).map(norm);
    const dealerCol = header.indexOf("work order (dealer)");
    const subCol = header.indexOf("work order (sub-dealer)");
    if (dealerCol === -1) {
      problems.push(`The "${tab}" tab has no "Work Order (Dealer)" column.`);
      continue;
    }
    const vinCol = header.indexOf("vin");
    if (vinCol === -1) {
      problems.push(`The "${tab}" tab has no "VIN" column.`);
      continue;
    }
    for (const r of rows.slice(1)) {
      const wo = normalizeWorkOrder(r[dealerCol]);
      const vin = normalizeVin(r[vinCol]);
      // A row with no VIN cannot be matched safely (the WIP counter restarts), so it is not listed.
      if (wo && vin && !list.has(`${wo}|${vin}`)) list.set(`${wo}|${vin}`, { workOrder: wo, vin, tab, subDealerWo: subCol === -1 ? null : String(r[subCol] ?? "").trim() || null });
    }
  }
  return { list, problems };
}

/**
 * Takes sub-dealer claims out of the audits that are still open: self-audit assignments nobody has started (cycle still
 * open) and internal-audit claims not checked yet (audit in progress). Work already done on one is kept.
 */
async function removeFromOpenAudits(): Promise<{ assignments: number; internal: number }> {
  const admin = createAdminClient();
  const { data: ids, error } = await admin.rpc("get_sub_dealer_claim_ids");
  if (error) throw new Error(error.message);
  const claimIds = [...new Set(ids ?? [])];
  let assignments = 0;
  let internal = 0;
  for (let i = 0; i < claimIds.length; i += 150) {
    const chunk = claimIds.slice(i, i + 150);
    const { data: rows } = await admin.from("self_audit_audit_assignments").select("id, cycle_id").eq("status", "not_started").in("claim_id", chunk);
    const cycleIds = [...new Set((rows ?? []).map((r) => r.cycle_id))];
    const { data: open } = cycleIds.length ? await admin.from("self_audit_audit_cycles").select("id").eq("status", "open").in("id", cycleIds) : { data: [] };
    const openIds = new Set((open ?? []).map((c) => c.id));
    const del = (rows ?? []).filter((r) => openIds.has(r.cycle_id)).map((r) => r.id);
    if (del.length) {
      const { error: e } = await admin.from("self_audit_audit_assignments").delete().in("id", del);
      if (e) throw new Error(e.message);
      assignments += del.length;
    }

    const { data: icRows } = await admin.from("self_audit_internal_audit_claims").select("id, internal_audit_id").is("checked_at", null).in("claim_id", chunk);
    const auditIds = [...new Set((icRows ?? []).map((r) => r.internal_audit_id))];
    const { data: running } = auditIds.length ? await admin.from("self_audit_internal_audits").select("id").eq("status", "in_progress").in("id", auditIds) : { data: [] };
    const runningIds = new Set((running ?? []).map((a) => a.id));
    const delIc = (icRows ?? []).filter((r) => runningIds.has(r.internal_audit_id)).map((r) => r.id);
    if (delIc.length) {
      const { error: e } = await admin.from("self_audit_internal_audit_claims").delete().in("id", delIc);
      if (e) throw new Error(e.message);
      internal += delIc.length;
    }
  }
  return { assignments, internal };
}

/** Copies the sub-dealer's sheet into the portal and takes its claims out of the open audits. A sheet that cannot be read changes nothing. */
export async function syncSubDealerWips(): Promise<SubDealerSyncResult> {
  const admin = createAdminClient();
  const fail = async (message: string): Promise<SubDealerSyncResult> => {
    await admin.from("self_audit_sub_dealer_sync").upsert({ id: 1, last_error: message.slice(0, 500) });
    return { error: message };
  };
  try {
    const { list, problems } = await readWorkOrders();
    if (problems.length) return fail(problems.join(" "));
    // An empty list would mean every WIP is no longer a sub-dealer one: treated as a read problem, never as the truth.
    if (list.size === 0) return fail("The sub-dealer sheet has no work orders - the list was not changed.");

    const now = new Date().toISOString();
    const rows = [...list.values()].map((v) => ({ work_order: v.workOrder, vin: v.vin, source_tab: v.tab, sub_dealer_wo: v.subDealerWo, synced_at: now }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from("self_audit_sub_dealer_wips").upsert(rows.slice(i, i + 500), { onConflict: "work_order,vin" });
      if (error) return fail(error.message);
    }
    const { error: delError } = await admin.from("self_audit_sub_dealer_wips").delete().lt("synced_at", now);
    if (delError) return fail(delError.message);

    const removed = await removeFromOpenAudits();
    await admin.from("self_audit_sub_dealer_sync").upsert({
      id: 1,
      synced_at: now,
      wip_count: rows.length,
      removed_assignments: removed.assignments,
      removed_internal_claims: removed.internal,
      last_error: null,
    });
    return { wips: rows.length, removedAssignments: removed.assignments, removedInternalClaims: removed.internal };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not read the sub-dealer sheet.");
  }
}
