import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CurrentUser } from "@/lib/auth";
import { agreementOpen, loadCourtesy } from "./sheet";
import { branchResolver } from "./branches";
import { agreementsTable } from "./agreements-server";
import { plateKey, serviceState, type Vehicle, type TransferStatus } from "./fleet";

// New tables (migration 0196): untyped handles until the generated types know them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => createAdminClient() as any;
export const vehiclesTable = () => db().from("self_audit_courtesy_vehicles");
export const eventsTable = () => db().from("self_audit_courtesy_vehicle_events");
export const transfersTable = () => db().from("self_audit_courtesy_transfers");

/** Reception manager (customer queue manager) or warranty officer: sets conditions, records services, sends / receives transfers. */
export const canManageFleet = (u: CurrentUser) => !u.viewOnly && (u.role === "officer" || u.queue_role === "manager");
/** Who may change a branch's courtesy car terms: as canManageFleet, and the branch's service manager (his own branch). */
export const canEditTerms = (u: CurrentUser) => canManageFleet(u) || u.managerKind === "service_manager" || u.role === "service_manager";
/** Warranty officers and national managers ask a branch to move a car. */
export const canRequestTransfer = (u: CurrentUser) => u.role === "officer" && (!u.viewOnly || u.managerKind === "national_manager");

/**
 * Copies the cars of the courtesy cars sheet the portal does not know yet (by plate), and - while both applications run
 * side by side - keeps the others aligned with the sheet: a car whose condition was never set in the portal takes the
 * sheet's status (available / maintenance / accident ...), and an empty branch, model or VIN is filled from the sheet.
 * A condition set in the portal, or a branch changed by a transfer, is never overwritten. Never throws.
 */
export async function syncFleet(): Promise<{ added: number; error?: string }> {
  try {
    const [sheet, resolve, { data: known }, { data: moved }] = await Promise.all([
      loadCourtesy(),
      branchResolver(),
      vehiclesTable().select("id, plate_key, condition, condition_at, branch_id, model, vin"),
      eventsTable().select("vehicle_id").eq("kind", "transfer_received"),
    ]);
    const transferred = new Set(((moved ?? []) as { vehicle_id: string }[]).map((m) => m.vehicle_id));
    type Known = { id: string; plate_key: string; condition: string; condition_at: string | null; branch_id: string | null; model: string | null; vin: string | null };
    const byKey = new Map(((known ?? []) as Known[]).map((k) => [k.plate_key, k]));
    const have = new Set(byKey.keys());
    const conditionFrom = (status: string) =>
      /accident|حادث/i.test(status) ? "accident" : /mainten|service|workshop|صيان/i.test(status) ? "maintenance" : /hold/i.test(status) ? "on_hold" : /sold|out of service|scrap/i.test(status) ? "out_of_service" : "available";
    const updates: { id: string; patch: Record<string, unknown> }[] = [];
    const c = sheet.cols.vehicles;
    const fresh = new Map<string, Record<string, unknown>>();
    for (const r of sheet.vehicles?.rows ?? []) {
      const plate = c.plate >= 0 ? r[c.plate]?.trim() : "";
      const key = plate ? plateKey(plate) : "";
      if (!key || fresh.has(key)) continue;
      const status = c.status >= 0 ? r[c.status] : "";
      const k = byKey.get(key);
      if (k) {
        const patch: Record<string, unknown> = {};
        if (!k.condition_at && status && conditionFrom(status) !== k.condition) patch.condition = conditionFrom(status);
        const b = c.branch >= 0 ? (resolve(r[c.branch])?.id ?? null) : null;
        if (b && b !== k.branch_id && (!k.branch_id || !transferred.has(k.id))) patch.branch_id = b;
        if (!k.model && c.model >= 0 && r[c.model]) patch.model = r[c.model];
        if (!k.vin && c.vin >= 0 && r[c.vin]) patch.vin = r[c.vin];
        if (Object.keys(patch).length) updates.push({ id: k.id, patch: { ...patch, updated_at: new Date().toISOString() } });
        continue;
      }
      if (have.has(key)) continue;
      fresh.set(key, {
        plate,
        plate_key: key,
        model: c.model >= 0 ? r[c.model] || null : null,
        vin: c.vin >= 0 ? r[c.vin] || null : null,
        branch_id: c.branch >= 0 ? (resolve(r[c.branch])?.id ?? null) : null,
        condition: conditionFrom(status),
      });
    }
    const rows = [...fresh.values()];
    for (let i = 0; i < rows.length; i += 200) {
      const { data } = await vehiclesTable().insert(rows.slice(i, i + 200)).select("id");
      if (data?.length) await eventsTable().insert((data as { id: string }[]).map((v) => ({ vehicle_id: v.id, kind: "added", body: "From the courtesy cars sheet" })));
    }
    for (const u of updates) await vehiclesTable().update(u.patch).eq("id", u.id);
    return { added: rows.length };
  } catch (e) {
    return { added: 0, error: e instanceof Error ? e.message : "The courtesy cars sheet could not be read." };
  }
}

/**
 * Open agreements of the other application (the courtesy cars sheet), while both run side by side: the car, the
 * customer's name, WIP, agreement number, date out and branch. Never throws (empty when the sheet cannot be read).
 */
export type SheetLoan = { key: string; plateKey: string; plate: string; customer: string; wip: string; agreement: string; out: string; branchId: string | null; status: string };
export async function sheetOpenLoans(): Promise<SheetLoan[]> {
  try {
    const [sheet, resolve] = await Promise.all([loadCourtesy(), branchResolver()]);
    const c = sheet.cols.agreements;
    return (sheet.agreements?.rows ?? [])
      .filter((r) => agreementOpen(r, c))
      .map((r, i) => {
        const plate = c.plate >= 0 ? r[c.plate] : "";
        return {
          key: `sheet-${i}`,
          plateKey: plateKey(plate),
          plate,
          customer: c.customer >= 0 ? r[c.customer] : "",
          wip: c.wip >= 0 ? r[c.wip] : "",
          agreement: c.agreement >= 0 ? r[c.agreement] : "",
          out: c.out >= 0 ? r[c.out] : "",
          branchId: c.branch >= 0 ? (resolve(r[c.branch])?.id ?? null) : null,
          status: c.status >= 0 ? r[c.status] : "",
        };
      })
      .filter((x) => x.plateKey);
  } catch {
    return [];
  }
}

/** The Status column of the sheet's Replacement Vehicles tab, per plate ("On loan", "Available", ...). Empty when unreadable. */
export async function sheetVehicleStatus(): Promise<Map<string, string>> {
  try {
    const sheet = await loadCourtesy();
    const c = sheet.cols.vehicles;
    const out = new Map<string, string>();
    if (c.plate < 0 || c.status < 0) return out;
    for (const r of sheet.vehicles?.rows ?? []) {
      const key = plateKey(r[c.plate] ?? "");
      if (key && r[c.status]?.trim()) out.set(key, r[c.status].trim());
    }
    return out;
  } catch {
    return new Map();
  }
}
/** A sheet status that means the car is out with a customer. */
export const SHEET_ON_LOAN = /on ?loan|loaned|in ?use|rented|with (the )?customer|مؤجر|مع العميل/i;

export type OpenLoan = { source?: "portal" | "sheet"; id: string; ref: string; customer_name: string; advisor_name: string | null; handed_over_at: string | null; expires_at: string | null; mileage_out: number | null; vehicle_id: string | null; vehicle_plate: string | null };
export type OpenTransfer = { id: string; vehicle_id: string; from_branch: string; to_branch: string; reason: string | null; status: TransferStatus; requested_by_name: string | null; requested_at: string; sent_at: string | null };
export type FleetRow = Vehicle & { branchName: string | null; loan: OpenLoan | null; transfer: OpenTransfer | null; service: ReturnType<typeof serviceState> };

/** The fleet of a branch (or every branch: null), each car with its open agreement, open transfer and service state. */
export async function loadFleet(branchId: string | null): Promise<{ rows: FleetRow[]; branches: { id: string; name: string; code: string | null; queue_code: string | null }[] }> {
  let vq = vehiclesTable().select("*").order("plate");
  if (branchId) vq = vq.eq("branch_id", branchId);
  const [{ data: vs }, { data: loans }, { data: trs }, { data: branches }, sheetLoans, sheetStatus] = await Promise.all([
    vq,
    agreementsTable().select("id, ref, customer_name, advisor_name, handed_over_at, expires_at, mileage_out, vehicle_id, vehicle_plate").eq("status", "open"),
    transfersTable().select("*").in("status", ["requested", "sent"]),
    createAdminClient().from("self_audit_branches").select("id, name, code, queue_code").order("name"),
    sheetOpenLoans(),
    sheetVehicleStatus(),
  ]);
  const name = new Map((branches ?? []).map((b) => [b.id, b.name]));
  /**
   * On loan: a portal agreement first; then, while the other application still runs, the sheet's Replacement Vehicles
   * status decides (On loan / Available) - with the customer of its open agreement when there is one; a car the sheet
   * does not list falls back to the sheet's open agreements.
   */
  const sheetLoanOf = (v: Vehicle): OpenLoan | null => {
    const agreement = sheetLoans.find((x) => x.plateKey === v.plate_key);
    const status = sheetStatus.get(v.plate_key);
    if (status !== undefined && !SHEET_ON_LOAN.test(status)) return null;
    if (status === undefined && !agreement) return null;
    return { source: "sheet", id: "", ref: agreement?.agreement || "Sheet", customer_name: agreement?.customer || "On loan (sheet)", advisor_name: "other application", handed_over_at: agreement?.out || null, expires_at: null, mileage_out: null, vehicle_id: v.id, vehicle_plate: v.plate };
  };
  const loanList = (loans ?? []) as OpenLoan[];
  const transfers = (trs ?? []) as OpenTransfer[];
  const rows = ((vs ?? []) as Vehicle[]).map((v) => ({
    ...v,
    branchName: v.branch_id ? (name.get(v.branch_id) ?? null) : null,
    loan:
      loanList.find((l) => l.vehicle_id === v.id || (!l.vehicle_id && l.vehicle_plate && plateKey(l.vehicle_plate) === v.plate_key)) ?? sheetLoanOf(v),
    transfer: transfers.find((t) => t.vehicle_id === v.id) ?? null,
    service: serviceState(v),
  }));
  // A branch also sees a car on its way to it.
  if (branchId) {
    const incoming = transfers.filter((t) => t.to_branch === branchId && t.status === "sent" && !rows.some((r) => r.id === t.vehicle_id)).map((t) => t.vehicle_id);
    if (incoming.length) {
      const { data } = await vehiclesTable().select("*").in("id", incoming);
      for (const v of (data ?? []) as Vehicle[]) rows.push({ ...v, branchName: v.branch_id ? (name.get(v.branch_id) ?? null) : null, loan: null, transfer: transfers.find((t) => t.vehicle_id === v.id) ?? null, service: serviceState(v) });
    }
  }
  return { rows, branches: (branches ?? []) as { id: string; name: string; code: string | null; queue_code: string | null }[] };
}

export async function addEvent(e: { vehicle_id: string; kind: string; body?: string | null; km?: number | null; agreement_id?: string | null; from_branch?: string | null; to_branch?: string | null; by?: CurrentUser | null }) {
  await eventsTable().insert({
    vehicle_id: e.vehicle_id,
    kind: e.kind,
    body: e.body ?? null,
    km: e.km ?? null,
    agreement_id: e.agreement_id ?? null,
    from_branch: e.from_branch ?? null,
    to_branch: e.to_branch ?? null,
    by_id: e.by?.id ?? null,
    by_name: e.by ? (e.by.full_name ?? e.by.email) : null,
  });
}

/** The vehicle for a plate (creates it when the car was typed in by hand). */
export async function vehicleForPlate(plate: string, fallback: { model?: string | null; vin?: string | null; branch_id: string }): Promise<Vehicle | null> {
  const key = plateKey(plate);
  if (!key) return null;
  const { data } = await vehiclesTable().select("*").eq("plate_key", key).maybeSingle();
  if (data) return data as Vehicle;
  const { data: made } = await vehiclesTable().insert({ plate: plate.trim(), plate_key: key, model: fallback.model || null, vin: fallback.vin || null, branch_id: fallback.branch_id }).select("*").maybeSingle();
  if (made) await addEvent({ vehicle_id: (made as Vehicle).id, kind: "added", body: "Typed in at a handover" });
  return (made as Vehicle | null) ?? null;
}

/** The branch's reception managers' e-mails (customer queue managers). */
export async function receptionManagerEmails(branchId: string): Promise<string[]> {
  const { data } = await createAdminClient().from("self_audit_users").select("email, role, queue_role").eq("branch_id", branchId);
  return (data ?? []).filter((u) => u.queue_role === "manager" || u.role === "service_manager").map((u) => u.email);
}
