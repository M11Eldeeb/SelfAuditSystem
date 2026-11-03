"use server";

import { requireAnyViewer } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { agreementOpen, loadCourtesy, type CourtesyCols, type SheetTable } from "@/lib/courtesy/sheet";
import { branchResolver } from "@/lib/courtesy/branches";

export type CourtesyData = {
  vehicles: SheetTable | null;
  agreements: SheetTable | null;
  cols: CourtesyCols;
  /** For each agreement row: still open (car with the customer). */
  open: boolean[];
  /** The portal branch name of each row (or null when the sheet does not say). */
  vehicleBranch: (string | null)[];
  agreementBranch: (string | null)[];
  scope: "all" | string;
  today: string;
  error?: string;
};

/** Courtesy cars: every replacement vehicle and agreement. Officers see all; a warranty admin his branch. */
export async function getCourtesyCars(): Promise<CourtesyData> {
  const user = await requireAnyViewer(["officer", "branch_admin"]);
  const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  const own = user.role === "officer" ? null : user.branch_id;
  try {
    const sheet = await loadCourtesy();
    const resolve = await branchResolver();
    const vb = (sheet.vehicles?.rows ?? []).map((r) => (sheet.cols.vehicles.branch >= 0 ? resolve(r[sheet.cols.vehicles.branch]) : null));
    const ab = (sheet.agreements?.rows ?? []).map((r) => (sheet.cols.agreements.branch >= 0 ? resolve(r[sheet.cols.agreements.branch]) : null));
    const keepV = (sheet.vehicles?.rows ?? []).map((_, i) => !own || vb[i]?.id === own);
    const keepA = (sheet.agreements?.rows ?? []).map((_, i) => !own || ab[i]?.id === own);
    const vehicles = sheet.vehicles ? { ...sheet.vehicles, rows: sheet.vehicles.rows.filter((_, i) => keepV[i]) } : null;
    const agreements = sheet.agreements ? { ...sheet.agreements, rows: sheet.agreements.rows.filter((_, i) => keepA[i]) } : null;
    let scope: "all" | string = "all";
    if (own) {
      const { data } = await createAdminClient().from("self_audit_branches").select("name").eq("id", own).maybeSingle();
      scope = data?.name ?? "Your branch";
    }
    return {
      vehicles,
      agreements,
      cols: sheet.cols,
      open: (agreements?.rows ?? []).map((r) => agreementOpen(r, sheet.cols.agreements)),
      vehicleBranch: vb.filter((_, i) => keepV[i]).map((b) => b?.name ?? null),
      agreementBranch: ab.filter((_, i) => keepA[i]).map((b) => b?.name ?? null),
      scope,
      today,
    };
  } catch (e) {
    return {
      vehicles: null,
      agreements: null,
      cols: { vehicles: { plate: -1, status: -1, branch: -1, model: -1, vin: -1 }, agreements: { wip: -1, plate: -1, status: -1, branch: -1, out: -1, back: -1, customer: -1, agreement: -1 } },
      open: [],
      vehicleBranch: [],
      agreementBranch: [],
      scope: "all",
      today,
      error: e instanceof Error ? e.message : "Could not read the courtesy cars sheet.",
    };
  }
}
