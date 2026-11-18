"use server";

import { revalidatePath } from "next/cache";
import { requireAnyViewer, requireRole } from "@/lib/auth";
import { refuseNonReception } from "@/lib/reception";
import { createAdminClient } from "@/lib/supabase/admin";
import { importLatestMsiReport, type MsiImportResult } from "@/lib/msi/import";
import { msiScopeFor, scopeExtra } from "@/lib/msi/scope";
import type { MsiExtra } from "@/lib/msi/types";

/**
 * The large part of a report (monthly closing, daily sales, KPIs, advisor targets) - kept for the newest report only.
 * A service manager or service advisor gets his own branch's part only.
 */
export async function getMsiExtra(reportDate: string): Promise<MsiExtra | null> {
  const user = await requireAnyViewer(["officer", "branch_admin", "service_advisor", "queue_user"]);
  refuseNonReception(user);
  const scope = await msiScopeFor(user);
  if (!scope) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("self_audit_msi_reports").select("extra, sales").eq("report_date", reportDate).maybeSingle();
  const extra = (data?.extra as MsiExtra | null) ?? null;
  if (!extra || scope.all) return extra;
  const name = (data?.sales as { scope: string; scopeName: string }[] | undefined)?.find((r) => r.scope === scope.code)?.scopeName ?? null;
  return scopeExtra(extra, scope.code, name);
}

/** Officers: look for a new e-mail now (the morning job does it too). */
export async function refreshMsi(): Promise<MsiImportResult> {
  await requireRole("officer");
  const result = await importLatestMsiReport();
  revalidatePath("/admin/msi");
  return result;
}
