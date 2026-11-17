"use server";

// Customer queue appointments (the DMS "Appointment Detail" sheet): a warranty officer uploads it, or reads the newest
// e-mail now (it is also read every hour by the daily job).

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getQueueAccess } from "@/lib/queue/server";
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
