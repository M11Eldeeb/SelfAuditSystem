import "server-only";
import type { CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { msiScopeFor } from "@/lib/msi/scope";
import { durationText, isLate, type InquiryStatus } from "@/lib/technical-inquiries";
import type { AdvisorRow, SalesRow } from "@/lib/msi/parse";
import { sameAdvisor } from "@/lib/reception";

/** One figure on the Home page's "My numbers" widget. */
export type HomeKpi = { label: string; value: string; note?: string; href?: string; tone?: "good" | "bad" };
export type HomeKpis = { title: string; items: HomeKpi[] };

const NONE = "00000000-0000-0000-0000-000000000000";
const DAY = 86_400_000;
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "-");
const sar = (v: number | null) => (v == null ? "-" : `${new Intl.NumberFormat("en-US", { notation: v >= 100_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(v)} SAR`);
const monthStart = () => {
  const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit" }).format(new Date()).split("-");
  return `${y}-${m}-01T00:00:00+03:00`;
};
const todayStart = () => `${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date())}T00:00:00+03:00`;

/** Technician claims: what this technician submitted and how much went through the first time. */
async function technicianKpis(user: CurrentUser, base: string): Promise<HomeKpi[]> {
  const { data } = await createAdminClient().from("self_audit_tech_claims").select("status, times_submitted, submitted_at").eq("technician_id", user.id).limit(5000);
  const rows = data ?? [];
  const submitted = rows.filter((r) => r.submitted_at);
  const approved = rows.filter((r) => r.status === "approved");
  const decided = rows.filter((r) => r.status === "approved" || r.status === "rejected");
  const firstTime = approved.filter((r) => r.times_submitted <= 1);
  const returned = rows.filter((r) => r.status === "returned").length;
  return [
    { label: "Claims submitted", value: String(submitted.length), href: base },
    { label: "Approved first time", value: pct(firstTime.length, decided.length), note: `${firstTime.length} of ${decided.length} decided claims`, tone: decided.length && firstTime.length / decided.length >= 0.8 ? "good" : undefined },
    { label: "Approval rate", value: pct(approved.length, decided.length), note: `${approved.length} approved` },
    { label: "Returned to fix", value: String(returned), tone: returned ? "bad" : undefined, href: base },
  ];
}

/** Technician claims of a branch (or all branches): what waits for a review. */
async function techClaimsKpis(branchId: string | null, href: string): Promise<HomeKpi[]> {
  const admin = createAdminClient();
  const scoped = <T extends { eq: (c: string, v: string) => T }>(q: T) => (branchId ? q.eq("branch_id", branchId) : q);
  const [{ count: waiting }, { data: month }] = await Promise.all([
    scoped(admin.from("self_audit_tech_claims").select("id", { count: "exact", head: true })).eq("status", "submitted"),
    scoped(admin.from("self_audit_tech_claims").select("status, times_submitted")).gte("reviewed_at", monthStart()).limit(5000),
  ]);
  const decided = (month ?? []).filter((r) => r.status === "approved" || r.status === "rejected");
  const firstTime = decided.filter((r) => r.status === "approved" && r.times_submitted <= 1);
  return [
    { label: "Technician claims to review", value: String(waiting ?? 0), tone: waiting ? "bad" : undefined, href },
    { label: "First-time approval, this month", value: pct(firstTime.length, decided.length), note: `${decided.length} claims decided` },
  ];
}

/** Technical inquiries the user may see (the database applies who sees what). */
async function inquiryKpis(href: string): Promise<HomeKpi[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 90 * DAY).toISOString();
  const { data } = await supabase.from("self_audit_technical_inquiries").select("status, created_at, first_response_at, waiting_since").gte("created_at", since).limit(5000);
  const rows = data ?? [];
  const open = rows.filter((r) => r.status === "open" || r.status === "awaiting_workshop").length;
  const late = rows.filter((r) => isLate(r.waiting_since, r.status as InquiryStatus)).length;
  const answers = rows.filter((r) => r.first_response_at).map((r) => new Date(r.first_response_at!).getTime() - new Date(r.created_at).getTime());
  return [
    { label: "Inquiries open", value: String(open), href },
    { label: "Waiting more than 2 days", value: String(late), tone: late ? "bad" : "good", href },
    { label: "Average first answer", value: durationText(answers.length ? answers.reduce((a, b) => a + b, 0) / answers.length : null), note: "Last 90 days" },
  ];
}

/** Revenue from the latest Major Service Indicators report: the branch's own lines, or the KSA lines for all branches. */
async function revenueKpis(user: CurrentUser, href: string): Promise<HomeKpi[]> {
  const allBranches = user.managerKind === "manager" || user.managerKind === "national_manager";
  const scope = await msiScopeFor(allBranches ? { ...user, role: "officer" } : user);
  if (!scope) return [];
  const { data } = await createAdminClient().from("self_audit_msi_reports").select("report_date, sales").order("report_date", { ascending: false }).limit(1).maybeSingle();
  if (!data) return [];
  const code = scope.all ? "KSA" : scope.code;
  const totals = ((data.sales ?? []) as SalesRow[]).filter((r) => r.scope === code && r.part === "Totals" && r.actual != null);
  const date = new Date(`${data.report_date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return totals.slice(0, 3).map((r) => ({
    label: `${r.type}${r.channel ? ` (${r.channel})` : ""}`,
    value: sar(r.actual),
    note: `${r.monthPct != null ? `${Math.round(r.monthPct * 100)}% of the month target` : "Month to date"} · ${date}`,
    tone: r.mtdPct != null ? (r.mtdPct >= 1 ? "good" : "bad") : undefined,
    href,
  }));
}

/** The service advisor's own line in the latest Major Service Indicators report: what he sold against his target. */
async function advisorKpis(user: CurrentUser): Promise<HomeKpi[]> {
  const scope = await msiScopeFor(user);
  if (!scope || scope.all) return [];
  const { data } = await createAdminClient().from("self_audit_msi_reports").select("report_date, advisors").order("report_date", { ascending: false }).limit(1).maybeSingle();
  const me = ((data?.advisors ?? []) as AdvisorRow[]).find((a) => a.kind === "advisor" && a.branch.toUpperCase().startsWith(scope.code) && sameAdvisor(a.name, user));
  if (!me) return [];
  const share = (v: number | null) => (v == null ? undefined : `${Math.round(v * 100)}%`);
  return [
    {
      label: "My sales this month",
      value: sar(me.achievement.total),
      note: me.target.total != null ? `Target ${sar(me.target.total)}${share(me.pctMonth) ? ` · ${share(me.pctMonth)} reached` : ""}` : (me.targetNote ?? undefined),
      tone: me.pctMtd != null ? (me.pctMtd >= 1 ? "good" : "bad") : undefined,
      href: "/advisor/msi",
    },
    { label: "My labor / parts", value: `${sar(me.achievement.labor)}`, note: `Parts ${sar(me.achievement.parts)}`, href: "/advisor/msi" },
  ];
}

/** Complaints in the advisor's name (his branch's file, his first and last name): the open ones first. */
async function complaintKpis(user: CurrentUser): Promise<HomeKpi[]> {
  const { data } = await createAdminClient().from("self_audit_complaints").select("service_advisor, resolved_on").eq("branch_id", user.branch_id ?? NONE).limit(5000);
  const mine = (data ?? []).filter((r) => sameAdvisor(r.service_advisor, user));
  const open = mine.filter((r) => !r.resolved_on).length;
  return [{ label: "Complaints in my name", value: String(open), note: open ? `Open now · ${mine.length} in total` : mine.length ? `None open · ${mine.length} in total` : "None - keep it up!", tone: open ? "bad" : "good", href: "/advisor/complaints" }];
}

/** Warranty claims uploaded this month (all branches, or one). */
async function claimsKpis(branchId: string | null, href: string): Promise<HomeKpi[]> {
  let q = createAdminClient().from("self_audit_claims").select("claim_amount, return_times").gte("creation_date", monthStart().slice(0, 10)).limit(20000);
  if (branchId) q = q.eq("branch_id", branchId);
  const { data } = await q;
  const rows = data ?? [];
  const amount = rows.reduce((s, r) => s + Number(r.claim_amount ?? 0), 0);
  const returned = rows.filter((r) => (r.return_times ?? 0) > 0).length;
  return [
    { label: "Warranty claims this month", value: String(rows.length), note: amount ? `${sar(amount)} claimed` : undefined, href },
    { label: "Returned at least once", value: pct(returned, rows.length), note: `${returned} claims`, tone: rows.length && returned / rows.length > 0.1 ? "bad" : undefined },
  ];
}

async function qcKpis(user: CurrentUser): Promise<HomeKpi[]> {
  const { data } = await createAdminClient().from("self_audit_qc_checks").select("status").eq("controller_id", user.id).gte("created_at", monthStart()).limit(5000);
  const rows = data ?? [];
  const passed = rows.filter((r) => r.status === "passed").length;
  return [
    { label: "QC checks this month", value: String(rows.length), href: "/qc" },
    { label: "Passed", value: pct(passed, rows.length), note: `${passed} passed`, tone: "good" },
  ];
}

async function queueKpis(user: CurrentUser): Promise<HomeKpi[]> {
  const { data } = await createAdminClient().from("self_audit_queue_tickets").select("status").eq("branch_id", user.branch_id ?? NONE).gte("created_at", todayStart()).limit(5000);
  const rows = data ?? [];
  return [
    { label: "Customers today", value: String(rows.length), href: "/queue" },
    { label: "Waiting now", value: String(rows.filter((r) => r.status === "waiting").length), href: "/queue" },
    { label: "Served", value: String(rows.filter((r) => r.status === "completed").length), tone: "good" },
  ];
}

/** The figures on a person's Home page: their own work, picked by role. A source that fails is left out, never the page. */
export async function homeKpisFor(user: CurrentUser, area: string): Promise<HomeKpis> {
  const safe = (p: Promise<HomeKpi[]>) => p.catch(() => [] as HomeKpi[]);
  const all = async (...parts: Promise<HomeKpi[]>[]) => (await Promise.all(parts.map(safe))).flat();

  if (area === "technician") return { title: "My claims", items: await all(technicianKpis(user, "/technician")) };
  if (area === "technical") return { title: "Technical inquiries", items: await all(inquiryKpis("/technical/technical-inquiries")) };
  if (area === "workshop") return { title: "My workshop", items: await all(inquiryKpis("/workshop/technical-inquiries")) };
  if (area === "reviewer") return { title: "Technician claims", items: await all(techClaimsKpis(user.branch_id ?? NONE, "/reviewer/technician-claims")) };
  if (area === "qc") return { title: "Quality control", items: await all(qcKpis(user)) };
  if (area === "queue") return { title: "Customer queue", items: await all(queueKpis(user)) };
  if (area === "advisor") return { title: "My numbers and my branch", items: await all(advisorKpis(user), revenueKpis(user, "/advisor/msi"), complaintKpis(user)) };
  if (area === "analyst") return { title: "Warranty", items: await all(claimsKpis(null, "/analyst/sub-dealer")) };
  if (area === "audit") {
    // Service manager: the money first; branch admin: the warranty work.
    if (user.managerKind === "service_manager") return { title: "My branch", items: await all(revenueKpis(user, "/audit/msi")) };
    return { title: "My branch", items: await all(claimsKpis(user.branch_id ?? NONE, "/audit/dashboard"), techClaimsKpis(user.branch_id ?? NONE, "/audit/technician-claims")) };
  }
  // The warranty officer's area: managers see the revenue, officers the warranty work.
  if (user.managerKind) return { title: "All branches", items: await all(revenueKpis(user, "/admin/msi"), claimsKpis(null, "/admin/dashboard")) };
  return { title: "Warranty", items: await all(claimsKpis(null, "/admin/dashboard"), inquiryKpis("/admin/technical-inquiries")) };
}
