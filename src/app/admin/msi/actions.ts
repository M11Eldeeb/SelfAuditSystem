"use server";

import { revalidatePath } from "next/cache";
import { requireAnyViewer, requireRole } from "@/lib/auth";
import { refuseNonReception } from "@/lib/reception";
import { createAdminClient } from "@/lib/supabase/admin";
import { importLatestMsiReport, type MsiImportResult } from "@/lib/msi/import";
import { msiScopeFor, scopeExtra } from "@/lib/msi/scope";
import type { MsiExtra } from "@/lib/msi/types";
import { JIAD_DEALER_CODE_SUFFIX_MAP } from "@/lib/parse-claims";

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

/** One branch in the 3D business view. Sales from the report; the rest live from the portal's own tables. */
export type BusinessBranch = {
  code: string;
  name: string;
  /** Major Service Indicators: sold so far, against the plan for today, and the month-end forecast against the target. */
  sold: number | null;
  vsPlan: number | null;
  forecastVsTarget: number | null;
  openWips: number;
  openWipValue: number;
  oldWips: number;
  warrantyClaims: number;
  complaints: number;
  complaintsOpen: number;
  techWaiting: number;
  /** Customer queue today: customers who took a ticket, and those still waiting now. */
  queueToday: number;
  queueWaiting: number;
};

/**
 * Officers (every branch): each branch's figures for the 3D view - sales of the report `reportDate`, open WIPs (and those
 * older than 30 days), warranty claims created this year, complaints this year (and still in progress), technician claims
 * waiting for review.
 */
export async function getBusinessView(reportDate: string): Promise<{ branches?: BusinessBranch[]; error?: string }> {
  const user = await requireAnyViewer(["officer"]);
  const scope = await msiScopeFor(user);
  if (!scope?.all) return { error: "Only for the warranty officers and managers." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return { error: "Bad date." };
  const admin = createAdminClient();
  const year = reportDate.slice(0, 4);
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const all = async <T,>(q: (from: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> => {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await q(from);
      out.push(...(data ?? []));
      if ((data ?? []).length < 1000) return out;
    }
  };
  const [{ data: branches }, { data: report }, wips, complaints, tech, queue] = await Promise.all([
    admin.from("self_audit_branches").select("id, code, name").order("name"),
    admin.from("self_audit_msi_reports").select("sales").eq("report_date", reportDate).maybeSingle(),
    all<{ branch_id: string | null; received: string | null; invoiceable: number | null }>((f) => admin.from("self_audit_open_wips").select("branch_id, received, invoiceable").range(f, f + 999)),
    all<{ branch_id: string | null; status: string | null }>((f) => admin.from("self_audit_complaints").select("branch_id, status").gte("created_on", `${year}-01-01`).range(f, f + 999)),
    all<{ branch_id: string }>((f) => admin.from("self_audit_tech_claims").select("branch_id").eq("status", "submitted").range(f, f + 999)),
    // Today in Saudi time (UTC+3).
    all<{ branch_id: string; status: string }>((f) =>
      admin
        .from("self_audit_queue_tickets")
        .select("branch_id, status")
        .gte("created_at", new Date(`${new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10)}T00:00:00+03:00`).toISOString())
        .range(f, f + 999),
    ),
  ]);
  const claims = new Map<string, number>(
    await Promise.all(
      (branches ?? []).map(async (b) => {
        const { count } = await admin.from("self_audit_claims").select("id", { count: "exact", head: true }).eq("branch_id", b.id).gte("creation_date", `${year}-01-01`);
        return [b.id, count ?? 0] as [string, number];
      }),
    ),
  );
  const sales = (report?.sales ?? []) as { scope: string; type: string; actual: number | null; mtdPct: number | null; forecast: number | null; monthTarget: number | null }[];
  const dealerOf = (code: string) => Object.entries(JIAD_DEALER_CODE_SUFFIX_MAP).find(([, c]) => c === code)?.[0];
  return {
    branches: (branches ?? [])
      .filter((b) => b.code)
      .map((b) => {
        const s = sales.find((r) => r.scope === dealerOf(b.code!) && r.type === "Branch total");
        const w = wips.filter((x) => x.branch_id === b.id);
        const c = complaints.filter((x) => x.branch_id === b.id);
        return {
          code: b.code!,
          name: b.name,
          sold: s?.actual ?? null,
          vsPlan: s?.mtdPct ?? null,
          forecastVsTarget: s?.forecast != null && s.monthTarget ? s.forecast / s.monthTarget : null,
          openWips: w.length,
          openWipValue: Math.round(w.reduce((n, x) => n + (Number(x.invoiceable) || 0), 0)),
          oldWips: w.filter((x) => x.received && x.received < old).length,
          warrantyClaims: claims.get(b.id) ?? 0,
          complaints: c.length,
          complaintsOpen: c.filter((x) => x.status && x.status !== "Closed").length,
          techWaiting: tech.filter((x) => x.branch_id === b.id).length,
          queueToday: queue.filter((x) => x.branch_id === b.id).length,
          queueWaiting: queue.filter((x) => x.branch_id === b.id && (x.status === "waiting" || x.status === "held")).length,
        };
      }),
  };
}
