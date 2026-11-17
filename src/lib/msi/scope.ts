import "server-only";
import type { CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { JIAD_DEALER_CODE_SUFFIX_MAP } from "@/lib/parse-claims";
import type { AdvisorRow, MsiExtra, MsiReport, SalesRow } from "./types";

/** What one person may see of a report: everything (officer, manager, national manager) or one branch (service manager, service advisor). */
export type MsiScope = { all: true } | { all: false; code: string; branchName: string } | null;

const NO_BRANCH = "00000000-0000-0000-0000-000000000000";

/** The report's branch code (A7, B7 ...) of the user's own branch. null: no access (a plain branch admin, or a branch the report does not know). */
export async function msiScopeFor(user: CurrentUser): Promise<MsiScope> {
  if (user.role === "officer") return { all: true };
  const branchRole = (user.role === "branch_admin" && user.managerKind === "service_manager") || user.role === "service_advisor";
  if (!branchRole) return null;
  const { data: branch } = await createAdminClient().from("self_audit_branches").select("code, name").eq("id", user.branch_id ?? NO_BRANCH).maybeSingle();
  if (!branch) return null;
  const code = Object.entries(JIAD_DEALER_CODE_SUFFIX_MAP).find(([, ours]) => ours === branch.code)?.[0];
  return code ? { all: false, code, branchName: branch.name } : null;
}

/** One branch's part of a report: its lines and its advisors only (never another branch's figures, the KSA totals or the wholesale sheet). */
export function scopeReport(report: MsiReport, code: string): MsiReport {
  const sales: SalesRow[] = report.sales.filter((r) => r.scope === code);
  const advisors: AdvisorRow[] = report.advisors.filter((a) => a.kind === "advisor" && a.branch.toUpperCase().startsWith(code));
  return { ...report, sales, advisors, wholesale: [] };
}

/** One branch's part of the big sheets. `scopeName`: the branch's name as the report's blocks spell it. */
export function scopeExtra(extra: MsiExtra, code: string, scopeName: string | null): MsiExtra {
  return {
    monthly: extra.monthly.filter((r) => r.scope === code),
    daily: extra.daily.filter((r) => r.scope === code),
    kpis: scopeName ? extra.kpis.filter((k) => k.branch === scopeName) : [],
    saTargets: extra.saTargets.filter((t) => t.branch === code),
  };
}
