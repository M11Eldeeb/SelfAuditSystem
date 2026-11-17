"use server";

import { revalidatePath } from "next/cache";
import { requireRole, requireViewer } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { importLatestMsiReport, type MsiImportResult } from "@/lib/msi/import";
import type { MsiExtra } from "@/lib/msi/types";

/** The large part of a report (monthly closing, daily sales, KPIs, advisor targets) - kept for the newest report only. */
export async function getMsiExtra(reportDate: string): Promise<MsiExtra | null> {
  await requireViewer("officer");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return null;
  const { data } = await createAdminClient().from("self_audit_msi_reports").select("extra").eq("report_date", reportDate).maybeSingle();
  return (data?.extra as MsiExtra | null) ?? null;
}

/** Officers: look for a new e-mail now (the morning job does it too). */
export async function refreshMsi(): Promise<MsiImportResult> {
  await requireRole("officer");
  const result = await importLatestMsiReport();
  revalidatePath("/admin/msi");
  return result;
}
