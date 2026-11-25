import "server-only";
import type { CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";
import type { QcTechnician } from "./constants";
import { cleanChecklist, type Checklist } from "./checklist";
import { fillMissingQcVins } from "./fill-vins";
import { ksaDay, qcRangeStart, type QcRangeKey } from "./range";

type CheckRow = Database["public"]["Tables"]["self_audit_qc_checks"]["Row"];
type TestRow = Database["public"]["Tables"]["self_audit_qc_tests"]["Row"];

const NONE = "00000000-0000-0000-0000-000000000000";

/** Which branch the user's QC pages show: null = every branch (officers), else his own branch. */
export function qcBranchScope(user: CurrentUser): string | null {
  if (user.role === "officer" || user.role === "national_manager" || user.view_all) return null;
  if (["quality_controller", "branch_admin", "service_manager", "workshop_supervisor"].includes(user.role)) return user.branch_id ?? NONE;
  return NONE;
}

export type QcSummary = {
  id: string;
  qcNo: string;
  branch: string;
  wip: string;
  model: string | null;
  purpose: string;
  status: CheckRow["status"];
  attempts: number;
  controller: string | null;
  technicians: string[];
  lastComment: string | null;
  createdAt: string;
  updatedAt: string;
  passedAt: string | null;
};

export type QcFile = { id: string; testId: string | null; name: string; mimeType: string; size: number; createdAt: string };
export type QcTest = { id: string; attempt: number; result: TestRow["result"]; comment: string | null; technicians: QcTechnician[]; finalOdometer: number | null; by: string | null; at: string; checklist: Checklist | null };
export type QcDetail = CheckRow & { branch: string; tests: QcTest[]; files: QcFile[] };

async function branchNames(): Promise<Map<string, string>> {
  const { data } = await createAdminClient().from("self_audit_branches").select("id, name");
  return new Map((data ?? []).map((b) => [b.id, b.name]));
}

/** The latest test of each check (for the technicians and the last comment in the list). */
async function latestTests(ids: string[]): Promise<Map<string, TestRow>> {
  const out = new Map<string, TestRow>();
  if (!ids.length) return out;
  const admin = createAdminClient();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from("self_audit_qc_tests").select("*").in("check_id", ids.slice(i, i + 200));
    for (const t of data ?? []) {
      const had = out.get(t.check_id);
      if (!had || t.attempt_no > had.attempt_no) out.set(t.check_id, t);
    }
  }
  return out;
}

export async function listQc(user: CurrentUser, opts: { status?: string; q?: string; branchId?: string; range?: QcRangeKey } = {}): Promise<QcSummary[]> {
  const scope = qcBranchScope(user);
  let q = createAdminClient().from("self_audit_qc_checks").select("*").order("updated_at", { ascending: false }).limit(300);
  if (scope) q = q.eq("branch_id", scope);
  else if (opts.branchId) q = q.eq("branch_id", opts.branchId);
  if (opts.status === "failed" || opts.status === "passed") q = q.eq("status", opts.status);
  else if (opts.status === "closed") q = q.in("status", ["passed", "closed"]);
  else if (opts.status === "closed_failed") q = q.eq("status", "closed");
  // The period (by the day the QC form was submitted), same buttons as the Quality Dashboard.
  const since = opts.range ? qcRangeStart(opts.range)?.toISOString() : null;
  if (since) q = q.gte("created_at", since);
  const term = opts.q?.trim().replace(/[^A-Za-z0-9 -]/g, "");
  if (term) q = q.or(`wip_no.ilike.%${term}%,qc_no.ilike.%${term}%,model.ilike.%${term}%${/^[A-Za-z0-9]{6,17}$/.test(term) ? `,vin.ilike.%${term}%` : ""}`);
  const [{ data }, names] = await Promise.all([q, branchNames()]);
  const rows = data ?? [];
  const last = await latestTests(rows.map((r) => r.id));
  return rows.map((r) => {
    const t = last.get(r.id);
    return {
      id: r.id,
      qcNo: r.qc_no,
      branch: names.get(r.branch_id) ?? "—",
      wip: r.wip_no,
      model: r.model,
      purpose: r.purpose,
      status: r.status,
      attempts: r.attempts,
      controller: r.controller_name,
      technicians: (t?.technicians ?? []).map((x) => x.name),
      lastComment: t?.comment ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      passedAt: r.passed_at,
    };
  });
}

export async function countQc(user: CurrentUser, range?: QcRangeKey): Promise<{ failed: number; closed: number; closedFailed: number }> {
  const scope = qcBranchScope(user);
  const admin = createAdminClient();
  const count = async (status: ("failed" | "passed" | "closed")[]) => {
    let q = admin.from("self_audit_qc_checks").select("id", { count: "exact", head: true }).in("status", status);
    const since = range ? qcRangeStart(range)?.toISOString() : null;
    if (since) q = q.gte("created_at", since);
    if (scope) q = q.eq("branch_id", scope);
    return (await q).count ?? 0;
  };
  const [failed, closed, closedFailed] = await Promise.all([count(["failed"]), count(["passed", "closed"]), count(["closed"])]);
  return { failed, closed, closedFailed };
}

export async function getQcDetail(user: CurrentUser, id: string): Promise<QcDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const admin = createAdminClient();
  let { data: c } = await admin.from("self_audit_qc_checks").select("*").eq("id", id).maybeSingle();
  if (!c) return null;
  // Saved without a VIN: look again in Open WIPs (FF3) and the invoicing labor lines (KH9).
  if (!c.vin && (await fillMissingQcVins([c.id]))) c = (await admin.from("self_audit_qc_checks").select("*").eq("id", id).maybeSingle()).data ?? c;
  const scope = qcBranchScope(user);
  if (scope && c.branch_id !== scope) return null;
  const [{ data: tests }, { data: files }, { data: branch }] = await Promise.all([
    admin.from("self_audit_qc_tests").select("*").eq("check_id", id).order("attempt_no"),
    admin.from("self_audit_qc_files").select("*").eq("check_id", id).order("created_at"),
    admin.from("self_audit_branches").select("name").eq("id", c.branch_id).maybeSingle(),
  ]);
  return {
    ...c,
    branch: branch?.name ?? "—",
    tests: (tests ?? []).map((t) => ({ id: t.id, attempt: t.attempt_no, result: t.result, comment: t.comment, technicians: t.technicians ?? [], finalOdometer: t.final_odometer, by: t.tested_by_name, at: t.created_at, checklist: t.checklist ? cleanChecklist(t.checklist, (t.checklist as Checklist).repairType ?? c.repair_type ?? "") : null })),
    files: (files ?? []).map((f) => ({ id: f.id, testId: f.test_id, name: f.file_name, mimeType: f.mime_type, size: Number(f.size_bytes), createdAt: f.created_at })),
  };
}

/** One QC file, if the user may see its QC. */
export async function qcFileFor(user: CurrentUser, fileId: string): Promise<{ driveId: string; name: string; mimeType: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return null;
  const admin = createAdminClient();
  const { data: f } = await admin.from("self_audit_qc_files").select("check_id, drive_file_id, file_name, mime_type").eq("id", fileId).maybeSingle();
  if (!f) return null;
  const scope = qcBranchScope(user);
  if (scope) {
    const { data: c } = await admin.from("self_audit_qc_checks").select("branch_id").eq("id", f.check_id).maybeSingle();
    if (!c || c.branch_id !== scope) return null;
  }
  return { driveId: f.drive_file_id, name: f.file_name, mimeType: f.mime_type };
}

// ---------------------------------------------------------------- analysis

const ksaDayOf = (iso: string) => ksaDay(Date.parse(iso));
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const shift = (m: string, n: number) => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/** One work order (QC) of the analysis, for the list a card opens. */
export type QcCheckBrief = {
  id: string;
  qcNo: string;
  wip: string;
  branch: string;
  model: string | null;
  purpose: string;
  status: CheckRow["status"];
  /** Tests done / of them failed. */
  tests: number;
  fails: number;
  firstPass: boolean;
  /** Failed at least once and is now passed. */
  recovered: boolean;
  /** Hours from the first fail to the pass (recovered ones). */
  reworkHours: number | null;
  /** Failed and waiting for a retest for more than 24 hours. */
  waitingOver24h: boolean;
  controller: string | null;
  technicians: string[];
  createdAt: string;
  updatedAt: string;
};
export type QcGroupRow = { key: string; checks: number; firstPass: number; fails: number; tests: number };
export type QcAnalysis = {
  range: QcRangeKey;
  /** The first and last day counted (Saudi dates, "2026-11-25"); startDay is null for "All time". */
  startDay: string | null;
  endDay: string;
  checks: number;
  passed: number;
  waiting: number;
  /** Cases closed as failed (no retest). */
  closedFailed: number;
  tests: number;
  failedTests: number;
  firstPass: number;
  /** Checks that failed at least once and are now passed. */
  recovered: number;
  avgAttemptsToPass: number | null;
  /** Hours from the first fail to the pass (median), for the checks that failed and then passed. */
  medianReworkHours: number | null;
  waitingOver24h: number;
  /** The chart: one bar per day for 1 week / 1 month, per month for longer periods. `key` is "2026-11-25" or "2026-11". */
  bucketUnit: "day" | "month";
  buckets: { key: string; checks: number; firstPass: number; fails: number }[];
  byPurpose: QcGroupRow[];
  byRepairType: QcGroupRow[];
  byModel: QcGroupRow[];
  byTechnician: QcGroupRow[];
  byTeamLeader: QcGroupRow[];
  byAdvisor: QcGroupRow[];
  byBranch: QcGroupRow[];
  byController: QcGroupRow[];
  topFailReasons: { text: string; count: number }[];
  /** Every work order of the period, for the lists the cards open. */
  checkList: QcCheckBrief[];
};

/**
 * Quality KPIs for the checks submitted in the period picked (counted on the day the QC form was submitted): first-time pass rate (the vehicle passed at the first test),
 * fail rate per test, tests per vehicle, rework time from a fail to the pass, vehicles still waiting for a test again -
 * overall, per month and per purpose / repair type / model / technician / team leader / service advisor / branch.
 */
export async function getQcAnalysis(user: CurrentUser, opts: { range: QcRangeKey; branchId?: string; branchIds?: string[] }): Promise<QcAnalysis> {
  const admin = createAdminClient();
  const scope = qcBranchScope(user);
  // From 00:00 Saudi time of the first day up to now (no start = all time).
  const start = qcRangeStart(opts.range)?.toISOString() ?? null;
  const checks: CheckRow[] = [];
  for (let page = 0; ; page++) {
    let q = admin.from("self_audit_qc_checks").select("*");
    if (start) q = q.gte("created_at", start);
    q = q.order("created_at").range(page * 1000, page * 1000 + 999);
    if (scope) q = q.eq("branch_id", scope);
    else if (opts.branchId) q = q.eq("branch_id", opts.branchId);
    else if (opts.branchIds?.length) q = q.in("branch_id", opts.branchIds);
    const { data } = await q;
    checks.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const tests: TestRow[] = [];
  const ids = checks.map((c) => c.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from("self_audit_qc_tests").select("*").in("check_id", ids.slice(i, i + 200));
    tests.push(...(data ?? []));
  }
  const names = await branchNames();
  const byCheck = new Map<string, TestRow[]>();
  for (const t of tests) byCheck.set(t.check_id, [...(byCheck.get(t.check_id) ?? []), t]);
  for (const list of byCheck.values()) list.sort((a, b) => a.attempt_no - b.attempt_no);

  const groups = {
    purpose: new Map<string, QcGroupRow>(),
    repair: new Map<string, QcGroupRow>(),
    model: new Map<string, QcGroupRow>(),
    tech: new Map<string, QcGroupRow>(),
    leader: new Map<string, QcGroupRow>(),
    advisor: new Map<string, QcGroupRow>(),
    branch: new Map<string, QcGroupRow>(),
    controller: new Map<string, QcGroupRow>(),
  };
  const row = (m: Map<string, QcGroupRow>, key: string) => {
    let r = m.get(key);
    if (!r) m.set(key, (r = { key, checks: 0, firstPass: 0, fails: 0, tests: 0 }));
    return r;
  };
  // The chart: a bar per day for a week / a month, per month for longer. Every day / month of the period gets a bar, empty ones too.
  const today = ksaDay(Date.now());
  const startDay = start ? ksaDayOf(start) : null;
  const bucketUnit: "day" | "month" = opts.range === "1w" || opts.range === "1m" ? "day" : "month";
  const firstDay = startDay ?? (checks.length ? ksaDayOf(checks[0].created_at) : today);
  const bucketKey = (day: string) => (bucketUnit === "day" ? day : day.slice(0, 7));
  const buckets = new Map<string, { key: string; checks: number; firstPass: number; fails: number }>();
  if (bucketUnit === "day") for (let d = firstDay; d <= today; d = nextDay(d)) buckets.set(d, { key: d, checks: 0, firstPass: 0, fails: 0 });
  else for (let m = firstDay.slice(0, 7); m <= today.slice(0, 7); m = shift(m, 1)) buckets.set(m, { key: m, checks: 0, firstPass: 0, fails: 0 });

  let firstPass = 0;
  let failedTests = 0;
  let recovered = 0;
  let attemptsToPass = 0;
  let passed = 0;
  let waitingOver24h = 0;
  const rework: number[] = [];
  const checkList: QcCheckBrief[] = [];
  const reasons = new Map<string, number>();
  const now = Date.now();

  for (const c of checks) {
    const list = byCheck.get(c.id) ?? [];
    const first = list[0];
    const fp = first?.result === "pass";
    const fails = list.filter((t) => t.result === "fail").length;
    if (fp) firstPass++;
    failedTests += fails;
    let reworkHours: number | null = null;
    const waitingLong = c.status === "failed" && now - Date.parse(c.updated_at) > 24 * 3_600_000;
    if (c.status === "passed") {
      passed++;
      attemptsToPass += list.length || 1;
      if (fails) {
        recovered++;
        const firstFail = list.find((t) => t.result === "fail");
        const pass = list.find((t) => t.result === "pass");
        if (firstFail && pass) {
          reworkHours = (Date.parse(pass.created_at) - Date.parse(firstFail.created_at)) / 3_600_000;
          rework.push(reworkHours);
        }
      }
    } else if (c.status === "failed" && now - Date.parse(c.updated_at) > 24 * 3_600_000) waitingOver24h++;
    for (const t of list) if (t.result === "fail" && t.comment) {
      const k = t.comment.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
      reasons.set(k, (reasons.get(k) ?? 0) + 1);
    }

    const add = (m: Map<string, QcGroupRow>, key: string | null | undefined) => {
      if (!key) return;
      const r = row(m, key);
      r.checks++;
      if (fp) r.firstPass++;
      r.fails += fails;
      r.tests += list.length;
    };
    add(groups.purpose, c.purpose);
    add(groups.repair, c.repair_type);
    add(groups.model, c.model);
    add(groups.leader, c.team_leader);
    add(groups.advisor, c.service_advisor);
    add(groups.branch, names.get(c.branch_id) ?? "—");
    add(groups.controller, c.controller_name);
    // A technician answers for the tests of the work he did: each test counts for the technicians named on it.
    const techSeen = new Set<string>();
    for (const t of list) {
      for (const tech of t.technicians ?? []) {
        const r = row(groups.tech, tech.name);
        r.tests++;
        if (t.result === "fail") r.fails++;
        if (!techSeen.has(tech.name)) {
          techSeen.add(tech.name);
          r.checks++;
          if (t.attempt_no === 1 && t.result === "pass") r.firstPass++;
        }
      }
    }
    checkList.push({
      id: c.id,
      qcNo: c.qc_no,
      wip: c.wip_no,
      branch: names.get(c.branch_id) ?? "—",
      model: c.model,
      purpose: c.purpose,
      status: c.status,
      tests: list.length,
      fails,
      firstPass: fp,
      recovered: c.status === "passed" && fails > 0,
      reworkHours,
      waitingOver24h: waitingLong,
      controller: c.controller_name,
      technicians: (list[list.length - 1]?.technicians ?? []).map((x) => x.name),
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    });
    const m = buckets.get(bucketKey(ksaDayOf(c.created_at)));
    if (m) {
      m.checks++;
      if (fp) m.firstPass++;
      m.fails += fails;
    }
  }

  rework.sort((a, b) => a - b);
  const sorted = (m: Map<string, QcGroupRow>) => [...m.values()].sort((a, b) => b.checks - a.checks || a.key.localeCompare(b.key));
  return {
    range: opts.range,
    startDay,
    endDay: today,
    checks: checks.length,
    passed,
    waiting: checks.filter((c) => c.status === "failed").length,
    closedFailed: checks.filter((c) => c.status === "closed").length,
    tests: tests.length,
    failedTests,
    firstPass,
    recovered,
    avgAttemptsToPass: passed ? attemptsToPass / passed : null,
    medianReworkHours: rework.length ? rework[Math.floor(rework.length / 2)] : null,
    waitingOver24h,
    bucketUnit,
    buckets: [...buckets.values()],
    byPurpose: sorted(groups.purpose),
    byRepairType: sorted(groups.repair),
    byModel: sorted(groups.model),
    byTechnician: sorted(groups.tech),
    byTeamLeader: sorted(groups.leader),
    byAdvisor: sorted(groups.advisor),
    byBranch: sorted(groups.branch),
    byController: sorted(groups.controller),
    checkList,
    topFailReasons: [...reasons.entries()].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count).slice(0, 10),
  };
}


// ---------------------------------------------------------------- drafts

export type QcDraft = { id: string; kind: "new" | "retest"; checkId: string | null; wip: string | null; data: Record<string, unknown>; updatedAt: string; controllerId: string };
type DraftRow = { id: string; kind: "new" | "retest"; check_id: string | null; wip: string | null; data: Record<string, unknown>; updated_at: string; controller_id: string; branch_id: string };
const drafts = () => (createAdminClient() as unknown as { from: (t: string) => ReturnType<ReturnType<typeof createAdminClient>["from"]> }).from("self_audit_qc_drafts");
const toDraft = (r: DraftRow): QcDraft => ({ id: r.id, kind: r.kind, checkId: r.check_id, wip: r.wip, data: r.data ?? {}, updatedAt: r.updated_at, controllerId: r.controller_id });

/** New-QC drafts of the controller's branch (newest first). Empty until the drafts table exists. */
export async function listQcDrafts(user: CurrentUser): Promise<QcDraft[]> {
  if (!user.branch_id) return [];
  const { data, error } = await drafts().select("*").eq("branch_id", user.branch_id).eq("kind", "new").order("updated_at", { ascending: false }).limit(50);
  return error ? [] : ((data ?? []) as unknown as DraftRow[]).map(toDraft);
}

export async function getQcDraft(user: CurrentUser, id: string): Promise<QcDraft | null> {
  if (!user.branch_id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await drafts().select("*").eq("id", id).eq("branch_id", user.branch_id).maybeSingle();
  return error || !data ? null : toDraft(data as unknown as DraftRow);
}

/** The saved retest of a failed QC, if any. */
export async function getRetestDraft(user: CurrentUser, checkId: string): Promise<QcDraft | null> {
  if (!user.branch_id) return null;
  const { data, error } = await drafts().select("*").eq("check_id", checkId).eq("kind", "retest").eq("branch_id", user.branch_id).maybeSingle();
  return error || !data ? null : toDraft(data as unknown as DraftRow);
}
