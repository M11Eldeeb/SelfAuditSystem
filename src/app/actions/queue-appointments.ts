"use server";

// Customer queue appointments (the DMS "Appointment Detail" sheet): a warranty officer uploads it, or reads the newest
// e-mail now (it is also read every hour by the daily job); advisors and queue managers add appointments by hand.

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getQueueAccess } from "@/lib/queue/server";
import { normalizeMobile, saudiDate } from "@/lib/queue/core";
import { importLatestAppointmentsMail, parseAppointmentsSheet, saveAppointments, type AppointmentImportResult } from "@/lib/queue/appointments";

async function officer() {
  const a = await getQueueAccess();
  if (!a?.admin || a.user.viewOnly) throw new Error("Only the warranty officers import appointments.");
  return a;
}

export async function uploadAppointments(formData: FormData): Promise<{ rows?: number; skipped?: number; error?: string }> {
  const a = await officer();
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose the appointments Excel file." };
  if (!/\.xlsx$/i.test(file.name)) return { error: "The file must be an Excel .xlsx file." };
  if (file.size > 10 * 1024 * 1024) return { error: "The file is larger than 10 MB." };
  let rows;
  try {
    rows = await parseAppointmentsSheet(await file.arrayBuffer());
  } catch {
    return { error: "This file could not be read as an Excel sheet." };
  }
  if (!rows.length) return { error: "No appointments found - expected the DMS Appointment Detail sheet (Wip No, Start Date, Time In, Telephone Number…)." };
  const r = await saveAppointments(rows, "upload");
  if (r.error) return { error: r.error };
  await createAdminClient().from("self_audit_queue_appointment_imports").insert({ source: "upload", file_name: file.name.slice(0, 200), rows: r.saved, imported_by: a.user.id });
  revalidatePath("/queue/appointments");
  return { rows: r.saved, skipped: r.skipped };
}

export async function checkAppointmentsMail(): Promise<AppointmentImportResult> {
  const a = await officer();
  const r = await importLatestAppointmentsMail({ userId: a.user.id });
  revalidatePath("/queue/appointments");
  return r;
}

// ---------- appointments made by hand (not in the DMS sheet) ----------

const SERVICE_TEXT = { quick_service: "Quick Service", general_repair: "Repair" } as const;

/**
 * A service advisor or the queue (reception) manager adds an appointment for their branch (head office: any branch).
 * The kiosk matches it like a sheet appointment: by mobile, else by WIP. The description says the services (Quick
 * Service / Repair) so the kiosk ticks them, then the note.
 */
export async function addManualAppointment(input: {
  branchId: string;
  date: string;
  time: string;
  name: string;
  mobile: string;
  wip?: string;
  vin?: string;
  services: string[];
  note?: string;
}): Promise<{ error?: string }> {
  const a = await getQueueAccess();
  if (!a || a.user.viewOnly || a.role === "parts_advisor") return { error: "Only service advisors and queue managers add appointments." };
  if (!(a.allBranches || a.branchId === input.branchId)) return { error: "You can add appointments for your branch only." };
  const today = saudiDate(new Date().toISOString());
  const max = saudiDate(new Date(Date.now() + 90 * 24 * 3600_000).toISOString());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.date < today || input.date > max) return { error: "Choose a date from today up to 90 days ahead." };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) return { error: "Choose the time." };
  const name = String(input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) return { error: "Enter the customer's name." };
  const mobile = normalizeMobile(input.mobile);
  if (!mobile) return { error: "Enter a Saudi mobile: 9 digits starting with 5." };
  const services = (["quick_service", "general_repair"] as const).filter((s) => input.services.includes(s));
  if (!services.length) return { error: "Choose Quick Service, Repair or both." };
  const vin = String(input.vin ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 17) || null;
  if (vin && vin.length !== 17) return { error: "The VIN has 17 characters (or leave it empty)." };
  const typedWip = String(input.wip ?? "").replace(/\D/g, "").replace(/^0+/, "").slice(0, 12);
  // No WIP yet: a number of its own (M + time), so the appointment is still unique; the customer is found by mobile.
  const wip = typedWip || `M${Date.now().toString().slice(-8)}`;
  const note = String(input.note ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const description = `${services.map((s) => SERVICE_TEXT[s]).join(" + ")}${note ? ` - ${note}` : ""}`;

  const admin = createAdminClient();
  const { data: branch } = await admin.from("self_audit_branches").select("id, active").eq("id", input.branchId).maybeSingle();
  if (!branch?.active) return { error: "Branch not found." };
  const { error } = await admin.from("self_audit_queue_appointments").insert({
    branch_id: branch.id,
    wip_no: wip,
    appt_date: input.date,
    appt_time: input.time,
    customer_name: name,
    mobile,
    vin,
    description,
    service_reception: a.user.full_name || a.user.email,
    status_text: "Added by hand",
    source: "manual",
    created_by: a.user.id,
    created_by_name: a.user.full_name || a.user.email,
  });
  if (error) return { error: error.code === "23505" ? `WIP ${wip} already has an appointment on that day.` : error.message };
  revalidatePath("/queue/appointments");
  return {};
}

/** Deletes an appointment added by hand: the person who added it, a queue manager of the branch, or head office. */
export async function deleteManualAppointment(id: string): Promise<{ error?: string }> {
  const a = await getQueueAccess();
  if (!a || a.user.viewOnly) return { error: "Not allowed." };
  const admin = createAdminClient();
  const { data: row } = await admin.from("self_audit_queue_appointments").select("id, branch_id, source, created_by").eq("id", id).maybeSingle();
  if (!row || row.source !== "manual") return { error: "Only appointments added by hand can be deleted here." };
  const mayDelete = row.created_by === a.user.id || (a.role === "manager" && (a.allBranches || a.branchId === row.branch_id));
  if (!mayDelete) return { error: "Only who added it or the queue manager can delete it." };
  const { error } = await admin.from("self_audit_queue_appointments").delete().eq("id", id).eq("source", "manual");
  if (error) return { error: error.message };
  revalidatePath("/queue/appointments");
  return {};
}
