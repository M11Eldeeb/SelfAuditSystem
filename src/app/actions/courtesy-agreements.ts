"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { photosToDrive } from "@/lib/courtesy/drive";
import { createAdminClient } from "@/lib/supabase/admin";
import { branchByCode } from "@/lib/queue/server";
import { sendMail } from "@/lib/gmail";
import { siteOrigin } from "@/lib/site-origin";
import { ID_RE, PHONE_RE, digitsOnly, isAdult, type CourtesyRequestInput, type DamageMark, DAMAGE_KINDS } from "@/lib/courtesy/agreements";
import { agreementsTable, branchAdvisors, courtesyStaff, nextRef, saveFile, type Agreement } from "@/lib/courtesy/agreements-server";
import { addEvent, receptionManagerEmails, vehicleForPlate, vehiclesTable } from "@/lib/courtesy/fleet-server";
import { serviceState, type Vehicle } from "@/lib/courtesy/fleet";

const PATHS = ["/advisor/courtesy-cars", "/admin/courtesy-cars", "/audit/courtesy-cars"];
const revalidateAll = () => PATHS.forEach((p) => revalidatePath(p, "layout"));
const todayKsa = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const IMAGE = /^image\/(jpeg|png|webp)$/;
const MAX_IMAGE = 8 * 1024 * 1024;
const extOf = (mime: string) => (mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg");
const okImage = (p: { base64: string; mimeType: string } | null | undefined) => !!p && IMAGE.test(p.mimeType) && p.base64.length > 0 && p.base64.length * 0.75 <= MAX_IMAGE;

/**
 * The customer's request (public - the branch's link / QR, no sign-in): checked, saved with his signature (and licence
 * photo), and his service advisor gets an e-mail with the link to prepare the car. Messages come back in his language.
 */
export async function submitCourtesyRequest(input: CourtesyRequestInput): Promise<{ ref?: string; error?: string }> {
  const ar = input.lang === "ar";
  const say = (en: string, arText: string) => ({ error: ar ? arText : en });
  const branch = await branchByCode(input.code);
  if (!branch) return say("Branch not found - check the QR code.", "الفرع غير موجود - تحقق من رمز QR.");
  const name = String(input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const phone = digitsOnly(String(input.phone ?? ""));
  const idNumber = digitsOnly(String(input.idNumber ?? ""));
  const nationality = String(input.nationality ?? "").trim().slice(0, 60);
  if (name.length < 3) return say("Write your full name.", "اكتب اسمك الكامل.");
  if (!PHONE_RE.test(phone)) return say("The mobile number must be 10 digits and start with 05.", "رقم الجوال يجب أن يكون 10 أرقام ويبدأ بـ 05.");
  if (!ID_RE.test(idNumber)) return say("The ID / Iqama number must be 10 digits.", "رقم الهوية / الإقامة يجب أن يكون 10 أرقام.");
  if (!isAdult(String(input.birthDate ?? ""), todayKsa())) return say("You must be 18 or older to receive a courtesy car.", "يجب أن يكون عمرك 18 سنة أو أكثر لاستلام سيارة بديلة.");
  if (!nationality) return say("Choose your nationality.", "اختر الجنسية.");
  if (!input.accepted) return say("Read and accept the terms and conditions.", "اقرأ الشروط والأحكام ووافق عليها.");
  if (!okImage({ base64: input.signature, mimeType: "image/png" })) return say("Sign in the box.", "وقّع داخل المربع.");
  const advisors = await branchAdvisors(branch.id);
  const advisor = advisors.find((a) => a.id === input.advisorId);
  if (!advisor) return say("Choose your service advisor.", "اختر مستشار الخدمة.");
  if (input.license && !okImage(input.license)) return say("The licence photo could not be read - take it again.", "تعذرت قراءة صورة الرخصة - التقطها مرة أخرى.");

  // The same customer pressing Submit twice: keep the first request.
  const { data: recent } = await agreementsTable()
    .select("ref")
    .eq("branch_id", branch.id)
    .eq("id_number", idNumber)
    .eq("status", "requested")
    .gte("requested_at", new Date(Date.now() - 15 * 60_000).toISOString())
    .maybeSingle();
  if (recent?.ref) return { ref: recent.ref as string };

  const admin = createAdminClient();
  const { data: b } = await admin.from("self_audit_branches").select("code, name").eq("id", branch.id).maybeSingle();
  try {
    const folder = `${branch.id}/${crypto.randomUUID()}`;
    const signature = await saveFile(folder, "customer-signature.png", Buffer.from(input.signature, "base64"), "image/png");
    const license = input.license ? await saveFile(folder, `licence.${extOf(input.license.mimeType)}`, Buffer.from(input.license.base64, "base64"), input.license.mimeType) : null;
    let row: { id: string; ref: string } | null = null;
    for (let attempt = 0; attempt < 4 && !row; attempt++) {
      const ref = await nextRef(b?.code ?? null);
      const { data, error } = await agreementsTable()
        .insert({
          ref,
          branch_id: branch.id,
          lang: ar ? "ar" : "en",
          customer_name: name,
          phone,
          id_number: idNumber,
          birth_date: input.birthDate,
          nationality,
          advisor_id: advisor.id,
          advisor_name: advisor.name,
          customer_signature: signature,
          license_photo: license,
          terms_accepted_at: new Date().toISOString(),
        })
        .select("id, ref")
        .single();
      if (!error) row = data;
      else if (!String(error.message).includes("duplicate")) throw new Error(error.message);
    }
    if (!row) throw new Error("no reference");

    // The advisor's e-mail.
    const { data: u } = await admin.from("self_audit_users").select("email, role").eq("id", advisor.id).maybeSingle();
    if (u?.email) {
      const area = u.role === "officer" ? "admin" : u.role === "branch_admin" || u.role === "service_manager" ? "audit" : "advisor";
      const link = `${await siteOrigin()}/${area}/courtesy-cars/${row.id}`;
      await sendMail({
        kind: "courtesy-request",
        to: [u.email],
        subject: `Courtesy car request ${row.ref} - ${name}`,
        text: `Dear ${advisor.name},\n\n${name} (mobile ${phone}) has filled in the courtesy car request at ${b?.name ?? "the branch"} and signed the terms.\n\nPlease choose the car, record the mileage, fuel and damages, and sign the handover:\n${link}\n\nReference: ${row.ref}\n\nWarranty Department - Jiad Modern Motors`,
        dedupeKey: `courtesy-request:${row.id}`,
      });
    }
    revalidateAll();
    return { ref: row.ref };
  } catch {
    return say("Could not send the request - please try again.", "تعذر إرسال الطلب - يرجى المحاولة مرة أخرى.");
  }
}

/** The agreement the signed-in staff member may work on (his branch; officers all). */
async function editable(id: string) {
  const s = await courtesyStaff();
  if (!s.canEdit) return { error: "View only." as const };
  const { data } = await agreementsTable().select("*").eq("id", id).maybeSingle();
  const a = data as Agreement | null;
  if (!a || (s.branchId && a.branch_id !== s.branchId)) return { error: "Agreement not found." as const };
  return { ...s, a };
}

/** One photo of the car (or the advisor's signature) for an agreement; returns its stored path. */
export async function uploadCourtesyPhoto(id: string, photo: { base64: string; mimeType: string }): Promise<{ path?: string; error?: string }> {
  const r = await editable(id);
  if ("error" in r) return { error: r.error };
  if (!okImage(photo)) return { error: "Photos only (JPEG / PNG), up to 8 MB." };
  try {
    return { path: await saveFile(`${r.a.branch_id}/${r.a.id}`, `car-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${extOf(photo.mimeType)}`, Buffer.from(photo.base64, "base64"), photo.mimeType) };
  } catch {
    return { error: "Could not save the photo - please try again." };
  }
}

export type HandoverInput = {
  vehicle: { label: string; plate: string; model: string; vin: string; vehicleId?: string };
  mileageOut: number;
  fuelOut: number;
  damages: DamageMark[];
  wipNo: string;
  expiresAt: string; // ISO
  notes: string;
  signature: string; // PNG base64
  photos: string[]; // paths from uploadCourtesyPhoto
};

/** The advisor hands the car over: the agreement opens. */
export async function handOverCourtesyCar(id: string, input: HandoverInput): Promise<{ error?: string }> {
  const r = await editable(id);
  if ("error" in r) return { error: r.error };
  if (r.a.status !== "requested") return { error: "This agreement was already handed over." };
  const plate = String(input.vehicle?.plate ?? "").trim();
  if (!plate) return { error: "Choose the courtesy car." };
  const km = Math.round(Number(input.mileageOut));
  if (!Number.isFinite(km) || km < 0 || km > 2_000_000) return { error: "Enter the mileage out." };
  const fuel = Math.round(Number(input.fuelOut));
  if (!Number.isFinite(fuel) || fuel < 0 || fuel > 100) return { error: "Choose the fuel level." };
  const wip = String(input.wipNo ?? "").replace(/\D/g, "");
  if (!wip) return { error: "Enter the WIP number." };
  const expires = new Date(input.expiresAt);
  if (Number.isNaN(expires.getTime()) || expires.getTime() < Date.now() - 60_000) return { error: "Choose the agreement expiry (in the future)." };
  if (!okImage({ base64: input.signature, mimeType: "image/png" })) return { error: "Sign in the box." };
  const kinds = new Set(DAMAGE_KINDS.map((k) => k.id));
  const damages = (Array.isArray(input.damages) ? input.damages : [])
    .slice(0, 60)
    .filter((d) => d && Number.isFinite(d.x) && Number.isFinite(d.y) && d.x >= 0 && d.x <= 1 && d.y >= 0 && d.y <= 1 && kinds.has(d.kind))
    .map((d) => ({ x: Math.round(d.x * 1000) / 1000, y: Math.round(d.y * 1000) / 1000, kind: d.kind, note: d.note ? String(d.note).slice(0, 80) : undefined }));
  const prefix = `${r.a.branch_id}/${r.a.id}/`;
  const photos = (Array.isArray(input.photos) ? input.photos : []).filter((p) => typeof p === "string" && p.startsWith(prefix)).slice(0, 20);
  try {
    const signature = await saveFile(`${r.a.branch_id}/${r.a.id}`, "advisor-signature.png", Buffer.from(input.signature, "base64"), "image/png");
    const now = new Date().toISOString();
    // The car in the portal's fleet (a car typed in by hand is added to it).
    let vehicle: Vehicle | null = null;
    if (input.vehicle.vehicleId) {
      const { data: v } = await vehiclesTable().select("*").eq("id", input.vehicle.vehicleId).maybeSingle();
      vehicle = (v as Vehicle | null) ?? null;
    }
    vehicle ??= await vehicleForPlate(plate, { model: input.vehicle.model, vin: input.vehicle.vin, branch_id: r.a.branch_id }).catch(() => null);
    if (vehicle) {
      const { data: busy } = await agreementsTable().select("ref").eq("vehicle_id", vehicle.id).eq("status", "open").maybeSingle();
      if (busy) return { error: `This car is already out on agreement ${busy.ref}.` };
    }
    const { data, error } = await agreementsTable()
      .update({
        status: "open",
        vehicle_id: vehicle?.id ?? null,
        vehicle_label: String(input.vehicle.label ?? "").slice(0, 200) || plate,
        vehicle_plate: plate.slice(0, 40),
        vehicle_model: String(input.vehicle.model ?? "").slice(0, 80) || null,
        vehicle_vin: String(input.vehicle.vin ?? "").slice(0, 40) || null,
        mileage_out: km,
        fuel_out: fuel,
        damages,
        wip_no: wip,
        expires_at: expires.toISOString(),
        notes: String(input.notes ?? "").trim().slice(0, 1000) || null,
        advisor_signature: signature,
        photos,
        handed_over_at: now,
        handed_over_by: r.user.id,
        handed_over_by_name: r.user.full_name ?? r.user.email,
        updated_at: now,
      })
      .eq("id", id)
      .eq("status", "requested")
      .select("id");
    if (error) return { error: error.message };
    if (!data?.length) return { error: "Someone else handed this car over just now - reload the page." };
    if (vehicle) {
      await vehiclesTable().update({ km: Math.max(km, vehicle.km ?? 0), updated_at: now }).eq("id", vehicle.id);
      await addEvent({ vehicle_id: vehicle.id, kind: "loan_out", km, agreement_id: id, body: `${r.a.ref} - ${r.a.customer_name}, WIP ${wip}`, by: r.user });
    }
    // The photos also go to Drive: Courtesy Cars / model / VIN - plate / <km> Km.
    if (photos.length) {
      const v = vehicle;
      after(() => photosToDrive({ agreementId: id, ref: r.a.ref, when: "out", vehicleKey: v?.id ?? plate, model: v?.model ?? (String(input.vehicle.model ?? "") || null), vin: v?.vin ?? (String(input.vehicle.vin ?? "") || null), plate: v?.plate ?? plate, km, paths: photos }));
    }
    revalidateAll();
    return {};
  } catch {
    return { error: "Could not save - please try again." };
  }
}

/** The car came back: mileage and fuel in; the agreement closes. */
export async function returnCourtesyCar(id: string, input: { mileageIn: number; fuelIn: number; note: string; damages?: DamageMark[]; photos?: string[] }): Promise<{ error?: string }> {
  const r = await editable(id);
  if ("error" in r) return { error: r.error };
  if (r.a.status !== "open") return { error: "This car is not out." };
  const km = Math.round(Number(input.mileageIn));
  if (!Number.isFinite(km) || km < (r.a.mileage_out ?? 0)) return { error: `The mileage in must be at least the mileage out (${r.a.mileage_out ?? 0} km).` };
  const fuel = Math.round(Number(input.fuelIn));
  if (!Number.isFinite(fuel) || fuel < 0 || fuel > 100) return { error: "Choose the fuel level." };
  const now = new Date().toISOString();
  const kinds = new Set(DAMAGE_KINDS.map((k) => k.id));
  const damages = (Array.isArray(input.damages) ? input.damages : [])
    .slice(0, 60)
    .filter((d) => d && Number.isFinite(d.x) && Number.isFinite(d.y) && d.x >= 0 && d.x <= 1 && d.y >= 0 && d.y <= 1 && kinds.has(d.kind))
    .map((d) => ({ x: Math.round(d.x * 1000) / 1000, y: Math.round(d.y * 1000) / 1000, kind: d.kind }));
  const prefix = `${r.a.branch_id}/${r.a.id}/`;
  const photos = (Array.isArray(input.photos) ? input.photos : []).filter((p) => typeof p === "string" && p.startsWith(prefix)).slice(0, 20);
  const { error } = await agreementsTable()
    .update({ status: "closed", mileage_in: km, fuel_in: fuel, return_damages: damages, return_photos: photos, return_note: String(input.note ?? "").trim().slice(0, 1000) || null, returned_at: now, returned_by_name: r.user.full_name ?? r.user.email, updated_at: now })
    .eq("id", id)
    .eq("status", "open");
  if (error) return { error: error.message };
  // The car's mileage and history; a car near or past its 10,000 km service: the branch's reception managers are told.
  if (r.a.vehicle_id) {
    const { data: v } = await vehiclesTable().select("*").eq("id", r.a.vehicle_id).maybeSingle();
    const vehicle = v as Vehicle | null;
    if (vehicle) {
      const updated = { ...vehicle, km: Math.max(km, vehicle.km ?? 0) };
      await vehiclesTable().update({ km: updated.km, updated_at: now }).eq("id", vehicle.id);
      await addEvent({ vehicle_id: vehicle.id, kind: "loan_in", km, agreement_id: id, body: `${r.a.ref} - ${(km - (r.a.mileage_out ?? km)).toLocaleString("en-US")} km driven${damages.length ? ` - ${damages.length} new damage mark(s)` : ""}`, by: r.user });
      if (photos.length) after(() => photosToDrive({ agreementId: id, ref: r.a.ref, when: "in", vehicleKey: vehicle.id, model: vehicle.model, vin: vehicle.vin, plate: vehicle.plate, km, paths: photos }));
      const sv = serviceState(updated);
      if (sv.state !== "ok" && sv.state !== "unknown" && vehicle.branch_id) {
        const to = await receptionManagerEmails(vehicle.branch_id);
        if (to.length)
          await sendMail({
            kind: "courtesy-service-due",
            to,
            subject: `Courtesy car ${vehicle.plate} ${sv.state === "due" ? "is due for service" : "is near its service"} (${updated.km?.toLocaleString("en-US")} km)`,
            text: `The courtesy car ${vehicle.model ?? ""} ${vehicle.plate} came back at ${updated.km?.toLocaleString("en-US")} km.\n\nNext service: ${sv.nextKm?.toLocaleString("en-US")} km (${sv.state === "due" ? `${Math.abs(sv.left ?? 0).toLocaleString("en-US")} km overdue` : `${sv.left?.toLocaleString("en-US")} km left`}).\n\nPlease book its service and set its condition to Maintenance in the portal (Courtesy Cars - Vehicles).\n\nWarranty Department - Jiad Modern Motors`,
            dedupeKey: `courtesy-service:${vehicle.id}:${sv.nextKm}:${sv.state}`,
          });
      }
    }
  }
  revalidateAll();
  return {};
}

/** A request that will not go ahead (no car, the customer left...). */
export async function cancelCourtesyAgreement(id: string): Promise<{ error?: string }> {
  const r = await editable(id);
  if ("error" in r) return { error: r.error };
  if (r.a.status !== "requested") return { error: "Only a request waiting for the car can be cancelled." };
  const { error } = await agreementsTable().update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "requested");
  if (error) return { error: error.message };
  revalidateAll();
  return {};
}
