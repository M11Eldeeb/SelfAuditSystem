import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAnyViewer, type CurrentUser } from "@/lib/auth";
import { refuseNonReception } from "@/lib/reception";
import { JIAD_DEALER_CODE_SUFFIX_MAP } from "@/lib/parse-claims";
import { loadCourtesy, agreementOpen } from "./sheet";
import { branchResolver } from "./branches";
import type { AgreementStatus, DamageMark } from "./agreements";

export const COURTESY_BUCKET = "courtesy";
const NO_BRANCH = "00000000-0000-0000-0000-000000000000";

export type Agreement = {
  id: string;
  ref: string;
  branch_id: string;
  status: AgreementStatus;
  lang: "ar" | "en";
  customer_name: string;
  phone: string;
  id_number: string;
  birth_date: string;
  nationality: string;
  advisor_id: string | null;
  advisor_name: string | null;
  customer_signature: string | null;
  license_photo: string | null;
  terms_accepted_at: string | null;
  requested_at: string;
  vehicle_label: string | null;
  vehicle_plate: string | null;
  vehicle_model: string | null;
  vehicle_vin: string | null;
  mileage_out: number | null;
  fuel_out: number | null;
  damages: DamageMark[];
  wip_no: string | null;
  expires_at: string | null;
  notes: string | null;
  advisor_signature: string | null;
  photos: string[];
  handed_over_at: string | null;
  handed_over_by: string | null;
  handed_over_by_name: string | null;
  mileage_in: number | null;
  fuel_in: number | null;
  return_note: string | null;
  returned_at: string | null;
  returned_by_name: string | null;
  updated_at: string;
};

// The table is new (migration 0195): read through an untyped handle until the generated types know it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const agreementsTable = () => (createAdminClient() as any).from("self_audit_courtesy_agreements");

/** Who may work with courtesy agreements: officers (all branches), branch admins, service advisors, reception. */
export async function courtesyStaff(): Promise<{ user: CurrentUser; branchId: string | null; canEdit: boolean }> {
  const user = await requireAnyViewer(["officer", "branch_admin", "service_advisor", "queue_user"]);
  refuseNonReception(user);
  const all = user.role === "officer";
  return { user, branchId: all ? null : (user.branch_id ?? NO_BRANCH), canEdit: !user.viewOnly };
}

/** The branch's service advisors (and reception managers) for the customer's drop-down: id and name (never e-mails). */
export async function branchAdvisors(branchId: string): Promise<{ id: string; name: string }[]> {
  const { data } = await createAdminClient()
    .from("self_audit_users")
    .select("id, full_name, email, role, queue_role")
    .eq("branch_id", branchId);
  return (data ?? [])
    .filter((u) => u.role === "service_advisor" || u.queue_role === "advisor" || u.queue_role === "manager")
    .map((u) => ({ id: u.id, name: (u.full_name || u.email.split("@")[0].replace(/[._]/g, " ")).trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Our branch code (HER) -> the dealer code used in references (A7). */
export const dealerCode = (code: string | null | undefined) => Object.entries(JIAD_DEALER_CODE_SUFFIX_MAP).find(([, c]) => c === (code ?? "").toUpperCase())?.[0] ?? (code ?? "XX").toUpperCase();

/** The next reference of the day for the branch: 20261123A7001. */
export async function nextRef(branchCode: string | null): Promise<string> {
  const day = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `${day}${dealerCode(branchCode)}`;
  const { data } = await agreementsTable().select("ref").like("ref", `${prefix}%`).order("ref", { ascending: false }).limit(1);
  const last = (data?.[0]?.ref as string | undefined)?.slice(prefix.length);
  return `${prefix}${String((Number(last) || 0) + 1).padStart(3, "0")}`;
}

export type FleetCar = { plate: string; model: string; vin: string; label: string };

/**
 * The branch's cars that are free: the courtesy cars sheet's vehicles of this branch whose status says available (or has
 * no status) and that are not out on an open agreement - neither in the sheet nor in the portal.
 */
export async function availableCars(branchId: string): Promise<{ cars: FleetCar[]; error?: string }> {
  try {
    const [sheet, resolve, { data: ours }] = await Promise.all([
      loadCourtesy(),
      branchResolver(),
      agreementsTable().select("vehicle_plate").eq("status", "open"),
    ]);
    const c = sheet.cols.vehicles;
    const ac = sheet.cols.agreements;
    const norm = (p: string) => p.toUpperCase().replace(/[^A-Z0-9؀-ۿ]/g, "");
    const busy = new Set<string>([
      ...((ours ?? []) as { vehicle_plate: string | null }[]).map((r) => norm(r.vehicle_plate ?? "")),
      ...(sheet.agreements?.rows ?? []).filter((r) => agreementOpen(r, ac) && ac.plate >= 0).map((r) => norm(r[ac.plate])),
    ]);
    const cars = (sheet.vehicles?.rows ?? [])
      .filter((r) => c.branch < 0 || resolve(r[c.branch])?.id === branchId)
      .filter((r) => c.status < 0 || !r[c.status] || /avail|free|ready|متاح/i.test(r[c.status]))
      .map((r) => {
        const plate = c.plate >= 0 ? r[c.plate] : "";
        const model = c.model >= 0 ? r[c.model] : "";
        const vin = c.vin >= 0 ? r[c.vin] : "";
        return { plate, model, vin, label: [model, plate, vin].filter(Boolean).join("  ") };
      })
      .filter((x) => x.plate && !busy.has(norm(x.plate)));
    return { cars };
  } catch (e) {
    return { cars: [], error: e instanceof Error ? e.message : "Could not read the courtesy cars sheet." };
  }
}

/** Saves a file in the private bucket; returns its path. */
export async function saveFile(folder: string, name: string, bytes: Buffer, contentType: string): Promise<string> {
  const path = `${folder}/${name}`;
  const { error } = await createAdminClient().storage.from(COURTESY_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(error.message);
  return path;
}

export async function readFile(path: string | null | undefined): Promise<Buffer | null> {
  if (!path) return null;
  const { data } = await createAdminClient().storage.from(COURTESY_BUCKET).download(path);
  return data ? Buffer.from(await data.arrayBuffer()) : null;
}
