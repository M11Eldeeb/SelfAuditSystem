import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSheetNamed } from "@/lib/google-sheets";

/**
 * Sub-dealer WIPs: Heraa (HER) work orders that are warranty job cards done for a sub-dealer. The sub-dealer's live Google
 * Sheet lists them in the column "Work Order (Dealer)" of its Claims and Free Service tabs. The list is copied into
 * self_audit_sub_dealer_wips every 30 minutes (/api/cron/sub-dealer-wips); those WIPs are marked "Sub-Dealer WIP" and
 * their claims are left out of the self audits and internal audits (see get_sub_dealer_claim_ids, migration 0165).
 */
export const SUB_DEALER_SHEET_ID = process.env.SUB_DEALER_SHEET_ID || "17aNXQXHJNn8Alo-3r2patbY1scw-EScbd9oyLfDD250";
export const SUB_DEALER_LABEL = "Sub-Dealer WIP";
const TABS = ["Claims", "Free Service"];
const BRANCH_CODE = "HER";

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** "her-44846 ", "HER 44846" or "44846" -> "HER-44846" (the form the claims use); "" when there is nothing to use. */
export function normalizeWorkOrder(v: unknown): string {
  const t = String(v ?? "").toUpperCase().replace(/\s+/g, "");
  if (!t) return "";
  return /^\d/.test(t) ? `${BRANCH_CODE}-${t}` : t;
}

/** The set of sub-dealer WIPs (normalised work orders) for marking WIPs in lists. Never throws: no list means no marks. */
export async function loadSubDealerSet(): Promise<Set<string>> {
  try {
    const set = new Set<string>();
    const admin = createAdminClient();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("self_audit_sub_dealer_wips").select("work_order").range(from, from + 999);
      if (error) return set;
      for (const r of data ?? []) set.add(r.work_order);
      if ((data ?? []).length < 1000) break;
    }
    return set;
  } catch {
    return new Set();
  }
}

/** True when this branch's WIP number (as the open WIP report or a claim writes it) is a sub-dealer WIP. */
export const isSubDealerWip = (set: Set<string>, branchCode: string | null | undefined, wip: string | null | undefined): boolean =>
  !!branchCode && !!wip && set.has(normalizeWorkOrder(/^\d/.test(String(wip).trim()) ? `${branchCode}-${wip}` : wip));

export type SubDealerSyncResult = { wips: number; removedAssignments: number; removedInternalClaims: number } | { error: string };

async function readWorkOrders(): Promise<{ list: Map<string, { tab: string; subDealerWo: string | null }>; problems: string[] }> {
  const list = new Map<string, { tab: string; subDealerWo: string | null }>();
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
    for (const r of rows.slice(1)) {
      const wo = normalizeWorkOrder(r[dealerCol]);
      if (wo && !list.has(wo)) list.set(wo, { tab, subDealerWo: subCol === -1 ? null : String(r[subCol] ?? "").trim() || null });
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
    const rows = [...list.entries()].map(([work_order, v]) => ({ work_order, source_tab: v.tab, sub_dealer_wo: v.subDealerWo, synced_at: now }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from("self_audit_sub_dealer_wips").upsert(rows.slice(i, i + 500), { onConflict: "work_order" });
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
