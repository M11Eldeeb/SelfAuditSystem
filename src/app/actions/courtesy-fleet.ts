"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMail } from "@/lib/gmail";
import { siteOrigin } from "@/lib/site-origin";
import { courtesyStaff } from "@/lib/courtesy/agreements-server";
import { addEvent, canEditTerms, canManageFleet, canRequestTransfer, receptionManagerEmails, transfersTable, vehiclesTable } from "@/lib/courtesy/fleet-server";
import { CONDITIONS, conditionOf, type Condition, type Vehicle } from "@/lib/courtesy/fleet";

const PATHS = ["/advisor/courtesy-cars", "/admin/courtesy-cars", "/audit/courtesy-cars"];
const revalidateAll = () => PATHS.forEach((p) => revalidatePath(p, "layout"));
const nameOf = (u: { full_name: string | null; email: string }) => u.full_name ?? u.email;

/** The car, if the signed-in person may manage it (his branch's reception manager, or a warranty officer). */
async function manageable(vehicleId: string) {
  const s = await courtesyStaff();
  if (!canManageFleet(s.user)) return { error: "Only the service manager, the reception manager or a warranty officer can change the car." as const };
  const { data } = await vehiclesTable().select("*").eq("id", vehicleId).maybeSingle();
  const v = data as Vehicle | null;
  if (!v || (s.branchId && v.branch_id !== s.branchId)) return { error: "Car not found." as const };
  return { ...s, v };
}

/** Available, accident, maintenance, on hold, out of service - with a note. */
export async function setVehicleCondition(vehicleId: string, condition: Condition, note: string): Promise<{ error?: string }> {
  const r = await manageable(vehicleId);
  if ("error" in r) return { error: r.error };
  if (!CONDITIONS.some((c) => c.id === condition)) return { error: "Choose a condition." };
  const text = String(note ?? "").trim().slice(0, 500);
  if (condition !== "available" && !text) return { error: "Write a short note (what happened / until when)." };
  const now = new Date().toISOString();
  const { error } = await vehiclesTable().update({ condition, condition_note: text || null, condition_at: now, updated_at: now }).eq("id", vehicleId);
  if (error) return { error: error.message };
  await addEvent({ vehicle_id: vehicleId, kind: "condition", body: `${conditionOf(r.v.condition).label} → ${conditionOf(condition).label}${text ? ` - ${text}` : ""}`, by: r.user });
  revalidateAll();
  return {};
}

/** The car was serviced at `km`: the next service is 10,000 km later. */
export async function recordVehicleService(vehicleId: string, km: number, date: string, note: string): Promise<{ error?: string }> {
  const r = await manageable(vehicleId);
  if ("error" in r) return { error: r.error };
  const k = Math.round(Number(km));
  if (!Number.isFinite(k) || k <= 0 || k > 2_000_000) return { error: "Enter the mileage at the service." };
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const { error } = await vehiclesTable().update({ last_service_km: k, last_service_at: day, km: Math.max(k, r.v.km ?? 0), updated_at: now }).eq("id", vehicleId);
  if (error) return { error: error.message };
  await addEvent({ vehicle_id: vehicleId, kind: "service", km: k, body: `Serviced at ${k.toLocaleString("en-US")} km on ${day}${note.trim() ? ` - ${note.trim().slice(0, 300)}` : ""}. Next at ${(k + (r.v.service_interval_km || 10000)).toLocaleString("en-US")} km.`, by: r.user });
  revalidateAll();
  return {};
}

/** The car's current mileage (read on the dashboard). */
export async function updateVehicleKm(vehicleId: string, km: number): Promise<{ error?: string }> {
  const r = await manageable(vehicleId);
  if ("error" in r) return { error: r.error };
  const k = Math.round(Number(km));
  if (!Number.isFinite(k) || k <= 0 || k > 2_000_000) return { error: "Enter the mileage." };
  if (r.v.km != null && k < r.v.km) return { error: `The mileage cannot go down (it was ${r.v.km.toLocaleString("en-US")} km).` };
  await vehiclesTable().update({ km: k, updated_at: new Date().toISOString() }).eq("id", vehicleId);
  await addEvent({ vehicle_id: vehicleId, kind: "km", km: k, body: `Mileage ${k.toLocaleString("en-US")} km`, by: r.user });
  revalidateAll();
  return {};
}

/** A note in the car's history (anyone of the branch who may see the car). */
export async function addVehicleNote(vehicleId: string, note: string): Promise<{ error?: string }> {
  const s = await courtesyStaff();
  if (!s.canEdit && !canRequestTransfer(s.user)) return { error: "View only." };
  const { data } = await vehiclesTable().select("id, branch_id").eq("id", vehicleId).maybeSingle();
  if (!data || (s.branchId && data.branch_id !== s.branchId)) return { error: "Car not found." };
  const text = String(note ?? "").trim().slice(0, 1000);
  if (!text) return { error: "Write the note." };
  await addEvent({ vehicle_id: vehicleId, kind: "note", body: text, by: s.user });
  revalidateAll();
  return {};
}

/** Warranty officers / national managers: ask the car's branch to move it to another branch. The branch is e-mailed. */
export async function requestVehicleTransfer(vehicleId: string, toBranch: string, reason: string): Promise<{ error?: string }> {
  const s = await courtesyStaff();
  if (!canRequestTransfer(s.user)) return { error: "Only warranty officers and national managers can ask for a transfer." };
  const { data } = await vehiclesTable().select("*").eq("id", vehicleId).maybeSingle();
  const v = data as Vehicle | null;
  if (!v || !v.branch_id) return { error: "Car not found (or it has no branch)." };
  if (toBranch === v.branch_id) return { error: "Choose another branch." };
  const admin = createAdminClient();
  const { data: branches } = await admin.from("self_audit_branches").select("id, name").in("id", [v.branch_id, toBranch]);
  const from = branches?.find((b) => b.id === v.branch_id);
  const to = branches?.find((b) => b.id === toBranch);
  if (!to) return { error: "Choose the branch." };
  const { data: open } = await transfersTable().select("id").eq("vehicle_id", vehicleId).in("status", ["requested", "sent"]).maybeSingle();
  if (open) return { error: "A transfer of this car is already open." };
  const text = String(reason ?? "").trim().slice(0, 500);
  const { error } = await transfersTable().insert({ vehicle_id: vehicleId, from_branch: v.branch_id, to_branch: toBranch, reason: text || null, requested_by: s.user.id, requested_by_name: nameOf(s.user) });
  if (error) return { error: error.message };
  await addEvent({ vehicle_id: vehicleId, kind: "transfer_requested", body: `${from?.name ?? "?"} → ${to.name}${text ? ` - ${text}` : ""}`, from_branch: v.branch_id, to_branch: toBranch, by: s.user });
  const mails = await receptionManagerEmails(v.branch_id);
  if (mails.length)
    await sendMail({
      kind: "courtesy-transfer",
      to: mails,
      subject: `Courtesy car transfer: ${v.plate} to ${to.name}`,
      text: `${nameOf(s.user)} asks to transfer the courtesy car ${v.model ?? ""} ${v.plate} from ${from?.name ?? "your branch"} to ${to.name}.${text ? `\n\nReason: ${text}` : ""}\n\nWhen the car leaves, mark it sent in the portal (Courtesy Cars - Vehicles):\n${await siteOrigin()}/advisor/courtesy-cars?tab=vehicles\n\nWarranty Department - Jiad Modern Motors`,
    });
  revalidateAll();
  return {};
}

/** The branch sent the car (from branch), the other branch received it (to branch) - or the request is cancelled. */
export async function moveTransfer(transferId: string, step: "sent" | "received" | "cancelled"): Promise<{ error?: string }> {
  const s = await courtesyStaff();
  const { data } = await transfersTable().select("*").eq("id", transferId).maybeSingle();
  const t = data as { id: string; vehicle_id: string; from_branch: string; to_branch: string; status: string } | null;
  if (!t) return { error: "Transfer not found." };
  const officer = canRequestTransfer(s.user);
  const manager = canManageFleet(s.user);
  const mine = (b: string) => !s.branchId || s.branchId === b;
  if (step === "cancelled" ? !(officer || (manager && mine(t.from_branch))) : !(manager && mine(step === "sent" ? t.from_branch : t.to_branch)))
    return { error: "Only that branch's service or reception manager (or a warranty officer) can do this." };
  const need = step === "sent" ? "requested" : step === "received" ? "sent" : null;
  if (need && t.status !== need) return { error: "This transfer has moved on - reload the page." };
  if (step === "cancelled" && !["requested", "sent"].includes(t.status)) return { error: "This transfer is closed." };
  const now = new Date().toISOString();
  const by = nameOf(s.user);
  const patch = step === "sent" ? { status: "sent", sent_at: now, sent_by_name: by } : step === "received" ? { status: "received", received_at: now, received_by_name: by } : { status: "cancelled", cancelled_at: now, cancelled_by_name: by };
  const { error } = await transfersTable().update(patch).eq("id", transferId).eq("status", t.status);
  if (error) return { error: error.message };
  if (step === "received") await vehiclesTable().update({ branch_id: t.to_branch, updated_at: now }).eq("id", t.vehicle_id);
  await addEvent({ vehicle_id: t.vehicle_id, kind: `transfer_${step}`, from_branch: t.from_branch, to_branch: t.to_branch, by: s.user });
  revalidateAll();
  return {};
}

export type SheetHit = { idx: number; agreement: string; plate: string; customer: string; wip: string; out: string; back: string; status: string; open: boolean; branch: string | null };

/** Search the other application's agreements (the courtesy cars sheet): plate, customer, WIP or agreement number. */
export async function searchOtherApplication(query: string): Promise<{ hits?: SheetHit[]; error?: string }> {
  const s = await courtesyStaff();
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  if (!words.length) return { error: "Type at least 2 letters or digits." };
  try {
    const [{ loadCourtesy, agreementOpen }, { branchResolver }] = await Promise.all([import("@/lib/courtesy/sheet"), import("@/lib/courtesy/branches")]);
    const [sheet, resolve] = await Promise.all([loadCourtesy(), branchResolver()]);
    const c = sheet.cols.agreements;
    const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "") : "");
    const hits: SheetHit[] = [];
    for (const [idx, r] of (sheet.agreements?.rows ?? []).entries()) {
      const b = c.branch >= 0 ? resolve(r[c.branch]) : null;
      if (s.branchId && b?.id !== s.branchId) continue;
      const text = r.join(" ").toLowerCase();
      if (!words.every((w) => text.includes(w))) continue;
      hits.push({ idx, agreement: cell(r, c.agreement), plate: cell(r, c.plate), customer: cell(r, c.customer), wip: cell(r, c.wip), out: cell(r, c.out), back: cell(r, c.back), status: cell(r, c.status), open: agreementOpen(r, c), branch: b?.name ?? null });
      if (hits.length >= 40) break;
    }
    return { hits: hits.reverse() };
  } catch {
    return { error: "The other application's sheet could not be read - please try again." };
  }
}

/**
 * The branch's reception manager (or a warranty officer) saves the courtesy car terms: a new version - who, when and what
 * changed are kept; earlier versions stay (agreements already signed keep theirs).
 */
export async function saveCourtesyTerms(branchId: string, terms: { en: string; ar: string }[], note: string): Promise<{ error?: string; version?: number }> {
  const s = await courtesyStaff();
  if (!canEditTerms(s.user)) return { error: "Only the service manager, the reception manager or a warranty officer can change the terms." };
  if (s.branchId && s.branchId !== branchId) return { error: "Only your own branch's terms." };
  const why = String(note ?? "").trim().slice(0, 500);
  if (!why) return { error: "Write what you changed." };
  const list = (Array.isArray(terms) ? terms : []).map((t) => ({ en: String(t?.en ?? "").trim().slice(0, 3000), ar: String(t?.ar ?? "").trim().slice(0, 3000) })).filter((t) => t.en || t.ar);
  if (!list.length || list.length > 40) return { error: "Keep between 1 and 40 terms." };
  if (list.some((t) => !t.en || !t.ar)) return { error: "Every term needs its English and its Arabic text." };
  const { termsTable } = await import("@/lib/courtesy/terms-server");
  const { data: last } = await termsTable().select("version").eq("branch_id", branchId).order("version", { ascending: false }).limit(1).maybeSingle();
  const version = ((last?.version as number | undefined) ?? 0) + 1;
  const { error } = await termsTable().insert({ branch_id: branchId, version, terms: list, note: why, created_by: s.user.id, created_by_name: s.user.full_name ?? s.user.email });
  if (error) return { error: error.message.includes("self_audit_courtesy_terms") ? "Not available yet - the database update (0198) is not applied." : error.message };
  revalidateAll();
  revalidatePath("/cc", "layout");
  return { version };
}
