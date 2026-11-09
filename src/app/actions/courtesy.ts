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

// Columns that hold the customer (name, phone, ID, e-mail, address, ...): never sent to the browser - only what the
// fleet report needs is kept. Plate, VIN, branch, dates and staff columns stay.
const CUSTOMER_COL = /customer|client|renter|hirer|driver|name|phone|mobile|tel|contact|e-?mail|iqama|national|id|identity|passport|licen[cs]e|address|عميل|اسم|جوال|هاتف|هوية|عنوان/i;
const KEEP_COL = /branch|model|plate|vehicle|car|agreement|status|stage|wip|advisor|employee|staff|created|updated|by|vin/i;

function withoutCustomer<K extends string>(table: SheetTable | null, cols: Record<K, number>, alsoDrop: number[] = []): { table: SheetTable | null; cols: Record<K, number> } {
  if (!table) return { table, cols };
  const keep = table.headers.map((h, i) => !alsoDrop.includes(i) && !(CUSTOMER_COL.test(h) && !KEEP_COL.test(h)));
  const newIndex: number[] = [];
  let n = 0;
  keep.forEach((k, i) => (newIndex[i] = k ? n++ : -1));
  const remapped = Object.fromEntries(Object.entries(cols).map(([k, i]) => [k, (i as number) >= 0 ? newIndex[i as number] : -1])) as Record<K, number>;
  return {
    table: { ...table, headers: table.headers.filter((_, i) => keep[i]), rows: table.rows.map((r) => r.filter((_, i) => keep[i])) },
    cols: remapped,
  };
}

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
    const open = (agreements?.rows ?? []).map((r) => agreementOpen(r, sheet.cols.agreements));
    const v = withoutCustomer(vehicles, sheet.cols.vehicles);
    const a = withoutCustomer(agreements, sheet.cols.agreements, [sheet.cols.agreements.customer]);
    return {
      vehicles: v.table,
      agreements: a.table,
      cols: { vehicles: v.cols, agreements: a.cols },
      open,
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
