import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { JIAD_DEALER_CODE_SUFFIX_MAP } from "@/lib/parse-claims";

/**
 * QCs saved without a VIN (the WIP was not in the Open WIPs report, FF3, yet) get it as soon as the WIP shows up: in FF3,
 * or in the invoicing report's labor lines (KH9). Matched on branch + WIP number. Never throws.
 * `ids`: only these QCs (a QC page being opened); otherwise every QC still missing its VIN.
 */
export async function fillMissingQcVins(ids?: string[]): Promise<number> {
  try {
    const admin = createAdminClient();
    let q = admin.from("self_audit_qc_checks").select("id, branch_id, wip_no").is("vin", null).limit(500);
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
      admin.from("self_audit_open_wips").select("branch_id, wip_no, vin").in("wip_no", digits),
      admin.from("self_audit_invoicing_detail").select("branch, wip, vin").eq("source", "labor").in("wip", digits).not("vin", "is", null).limit(5000),
    ]);
    const clean = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/\s+/g, "") || null;

    let filled = 0;
    for (const c of missing) {
      const wip = c.wip_no.replace(/\D/g, "");
      const dealer = dealerOf.get(codeOf.get(c.branch_id) ?? "");
      const vin =
        clean(open?.find((o) => o.branch_id === c.branch_id && String(o.wip_no).replace(/\D/g, "") === wip && clean(o.vin))?.vin) ??
        clean(invoiced?.find((i) => (!dealer || i.branch === dealer) && String(i.wip).replace(/\D/g, "") === wip && clean(i.vin))?.vin);
      if (!vin) continue;
      const { error } = await admin.from("self_audit_qc_checks").update({ vin }).eq("id", c.id).is("vin", null);
      if (!error) filled++;
    }
    return filled;
  } catch {
    return 0;
  }
}
