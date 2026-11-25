import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { JIAD_DEALER_CODE_SUFFIX_MAP } from "@/lib/parse-claims";

/** The operator's name as the reports write it ("MoayedAlothman", "Mohammed.Alkhalifah"), as words (null when empty). */
export function cleanOperator(v: string | null | undefined): string | null {
  let s = (v ?? "").replace(/\./g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (!/\s/.test(s)) s = s.replace(/([a-z])([A-Z])/g, "$1 $2");
  return s.slice(0, 120);
}

/**
 * QCs saved without a VIN or a service advisor (the WIP was not in the Open WIPs report, FF3, yet) get them as soon as the WIP
 * shows up: in FF3, or in the invoicing report's labor lines (KH9). The service advisor is the WIP's owning operator.
 * Matched on branch + WIP number. Never throws.
 * `ids`: only these QCs (a QC page being opened); otherwise every QC still missing one of the two.
 */
export async function fillMissingQcVins(ids?: string[]): Promise<number> {
  try {
    const admin = createAdminClient();
    let q = admin.from("self_audit_qc_checks").select("id, branch_id, wip_no, vin, service_advisor").or("vin.is.null,service_advisor.is.null").limit(500);
    if (ids?.length) q = q.in("id", ids);
    const { data: missing } = await q;
    if (!missing?.length) return 0;

    const { data: branches } = await admin.from("self_audit_branches").select("id, code");
    const codeOf = new Map((branches ?? []).map((b) => [b.id, (b.code ?? "").toUpperCase()]));
    // Our branch code -> the dealer code the reports use (HER -> A7).
    const dealerOf = new Map(Object.entries(JIAD_DEALER_CODE_SUFFIX_MAP).map(([dealer, code]) => [code, dealer]));
    const digits = [...new Set(missing.map((c) => c.wip_no.replace(/\D/g, "")).filter(Boolean))];
    if (!digits.length) return 0;

    const [{ data: open }, { data: invoiced }] = await Promise.all([
      admin.from("self_audit_open_wips").select("branch_id, wip_no, vin, operator").in("wip_no", digits),
      admin.from("self_audit_invoicing_detail").select("branch, wip, vin, owing_operator").eq("source", "labor").in("wip", digits).limit(5000),
    ]);
    const clean = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/\s+/g, "") || null;

    let filled = 0;
    for (const c of missing) {
      const wip = c.wip_no.replace(/\D/g, "");
      const dealer = dealerOf.get(codeOf.get(c.branch_id) ?? "");
      const openRows = (open ?? []).filter((o) => o.branch_id === c.branch_id && String(o.wip_no).replace(/\D/g, "") === wip);
      const invoicedRows = (invoiced ?? []).filter((i) => (!dealer || i.branch === dealer) && String(i.wip).replace(/\D/g, "") === wip);
      const vin = c.vin ? null : (clean(openRows.find((o) => clean(o.vin))?.vin) ?? clean(invoicedRows.find((i) => clean(i.vin))?.vin));
      const advisor = c.service_advisor ? null : (cleanOperator(openRows.find((o) => cleanOperator(o.operator))?.operator) ?? cleanOperator(invoicedRows.find((i) => cleanOperator(i.owing_operator))?.owing_operator));
      if (!vin && !advisor) continue;
      const { error } = await admin.from("self_audit_qc_checks").update({ ...(vin ? { vin } : {}), ...(advisor ? { service_advisor: advisor } : {}) }).eq("id", c.id);
      if (!error) filled++;
    }
    return filled;
  } catch {
    return 0;
  }
}
