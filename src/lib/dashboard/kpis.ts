import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

/**
 * One claim, trimmed to just what the KPI dashboard needs. Fields that only
 * live in raw_row (Status, First Submit Date, Adjusted Claim TOL., ...) are
 * pulled out server-side by PostgREST's ->> operator instead of shipping the
 * whole ~80-key raw_row per claim.
 */
type DashboardClaim = {
  branch_id: string;
  claim_number: string;
  work_order_no: string | null;
  vin: string | null;
  labor_code: string | null;
  claim_amount: number | null;
  repair_end_date: string | null;
  creation_date: string;
  return_times_dealer: number | null;
  status: string | null;
  first_submit: string | null;
  verification: string | null;
  settlement: string | null;
  adjusted: string | null;
  part_before: string | null;
  part_adjusted: string | null;
  labor_before: string | null;
  labor_adjusted: string | null;
  sublet_before: string | null;
  sublet_adjusted: string | null;
  labor_name: string | null;
  part_name: string | null;
  series: string | null;
  currency: string | null;
};

const CLAIM_SELECT = [
  "branch_id",
  "claim_number",
  "work_order_no",
  "vin",
  "labor_code",
  "claim_amount",
  "repair_end_date",
  "creation_date",
  "return_times_dealer",
  "status:raw_row->>Status",
  'first_submit:raw_row->>"First Submit Date"',
  'verification:raw_row->>"Verification Date"',
  'settlement:raw_row->>"Settlement Date"',
  'adjusted:raw_row->>"Adjusted Claim TOL."',
  'part_before:raw_row->>"Part TOL. Before Adjustment"',
  'part_adjusted:raw_row->>"Adjusted Part TOL."',
  'labor_before:raw_row->>"Labor TOL. Before Adjustment"',
  'labor_adjusted:raw_row->>"Adjusted Labor TOL."',
  'sublet_before:raw_row->>"Sublet TOL.Before Adjustment"',
  'sublet_adjusted:raw_row->>"Adjusted Sublet TOL."',
  'labor_name:raw_row->>"Main Labor Name"',
  "part_name:main_part_name",
  'series:raw_row->>"Vehicle Series"',
  "currency:raw_row->>currency",
].join(",");

// Never actually submitted to SAIC, so not a real claim for any KPI.
const UNSUBMITTED_STATUSES = new Set(["Draft saved", "Saved"]);

const PAGE = 1000;

/**
 * Pages through a query in parallel: one count request first, then every
 * page at once, instead of the sequential selectAllRows loop.
 */
async function fetchAllParallel<T>(
  count: (q: Client) => PromiseLike<{ count: number | null; error: { message: string } | null }>,
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  supabase: Client
): Promise<T[]> {
  const { count: total, error } = await count(supabase);
  if (error) throw new Error(error.message || "Timed out counting rows.");
  const pages = Math.ceil((total ?? 0) / PAGE);
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) => page(i * PAGE, i * PAGE + PAGE - 1))
  );
  return results.flatMap((r) => {
    if (r.error) throw new Error(r.error.message || "Timed out loading rows.");
    return (r.data as T[]) ?? [];
  });
}

/** Runs async tasks with at most `limit` in flight at once. */
async function runPooled<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await tasks[i]();
      }
    })
  );
  return results;
}

/**
 * Claims for the given branches and repair-end months, fetched one
 * (branch, month) slice at a time - each slice is a few hundred rows read
 * straight off the (branch_id, repair_end_date) index. A single query over
 * the whole range paged with range() re-sorts the full result for every
 * page and times out on a 12-month range (~25,000 claims).
 */
async function fetchClaims(supabase: Client, branchIds: string[], months: string[]): Promise<DashboardClaim[]> {
  const tasks = branchIds.flatMap((branchId) =>
    months.map((m) => async () => {
      const rows: DashboardClaim[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("self_audit_claims")
          .select(CLAIM_SELECT)
          .eq("branch_id", branchId)
          .gte("repair_end_date", `${m}-01`)
          .lte("repair_end_date", monthEnd(m))
          .order("id")
          .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message || "Timed out loading claims.");
        const page = (data ?? []) as unknown as DashboardClaim[];
        rows.push(...page);
        if (page.length < PAGE) break;
      }
      return rows;
    })
  );
  return (await runPooled(tasks, 8)).flat();
}

// --- date & number helpers ----------------------------------------------------

const DAY_MS = 86_400_000;

function toUtcMs(value: string): number {
  // Dates come through as "yyyy-MM-dd", "yyyy/MM/dd" or a full timestamp.
  return Date.parse(/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(value) ? `${value.replace(/\//g, "-")}T00:00:00Z` : value);
}

function isoDate(value: string | null): string | null {
  if (!value) return null;
  const t = toUtcMs(value);
  return isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

function daysBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = toUtcMs(from);
  const b = toUtcMs(to);
  if (isNaN(a) || isNaN(b)) return null;
  return (b - a) / DAY_MS;
}

function finite(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v != null && isFinite(v));
}

function average(values: (number | null)[]): number | null {
  const nums = finite(values);
  return nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
}

function median(values: (number | null)[]): number | null {
  const nums = finite(values).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function monthEnd(yyyyMM: string): string {
  const [y, m] = yyyyMM.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function listMonths(from: string, to: string): string[] {
  const months: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

/** Day weight in JIAD's work week: Saturday to Wednesday full, Thursday half, Friday off. */
function dayWeight(dow: number): number {
  return dow === 5 ? 0 : dow === 4 ? 0.5 : 1;
}

/** Working days between two dates (inclusive), weighted as above. */
export function workingDays(fromDate: string, toDate: string): number {
  let total = 0;
  for (let t = toUtcMs(fromDate); t <= toUtcMs(toDate); t += DAY_MS) total += dayWeight(new Date(t).getUTCDay());
  return total;
}

/** "HER-12345-2" -> "HER-12345": the repeat suffix marks another claim on the same WIP. */
export function baseJobCard(workOrderNo: string | null): string | null {
  if (!workOrderNo) return null;
  const trimmed = workOrderNo.trim();
  return trimmed.match(/^([A-Za-z]+-\d+)/)?.[1]?.toUpperCase() ?? trimmed.toUpperCase();
}

function num(value: string | number | null): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

// --- KPI types ----------------------------------------------------------------

/** Share of values falling in each [label, upper bound) bucket; last bucket is open-ended. */
export type Bucket = { label: string; count: number };

export type CycleMetric = { avg: number | null; median: number | null; buckets: Bucket[] };

export type ClaimKpis = {
  claimCount: number;
  totalClaimAmount: number;
  totalAdjustedAmount: number;
  detectedAmount: number;
  submittedCount: number;
  acceptedFirstTime: number;
  topBoxPct: number | null;
  avgDailyClaims: number | null;
  workingDays: number;
  wipCount: number;
  claimsPerWip: number | null;
  avgRepairCompletionDays: number | null;
  avgClaimSubmissionDays: number | null;
};

export type RankedItem = { label: string; sublabel?: string; count: number; amount: number };

export type ScorePoint = { month: string; branchId: string; score: number };

export type BranchRow = ClaimKpis & {
  branchId: string;
  name: string;
  avgSelfAuditDays: number | null;
  avgScrapEvidenceDays: number | null;
  warrantyRoomParts: number;
  flaggedToScrap: number;
};

export type PendingTask = {
  branchId: string;
  name: string;
  selfAudit: {
    cycleId: string;
    cycleLabel: string;
    pending: number;
    total: number;
    deadline: string | null;
    generatedAt: string;
    firstPendingAssignmentId: string | null;
  } | null;
  scrapEvidence: { cycleId: string; cycleLabel: string; status: "submitted" | "approved" | "not_submitted"; generatedAt: string } | null;
};

export type ClaimRow = {
  claimNumber: string;
  workOrderNo: string | null;
  vin: string | null;
  branch: string;
  series: string | null;
  laborName: string | null;
  partName: string | null;
  status: string | null;
  amount: number;
  adjusted: number;
  openDate: string;
  repairEnd: string | null;
  firstSubmit: string | null;
  repairDays: number | null;
  submitDays: number | null;
};

export type PeriodPoint = { label: string; claimed: number; adjusted: number; count: number };

export type WeekdayPoint = { dow: number; label: string; repaired: number; submitted: number; days: number };

export type SeriesStat = { series: string; count: number; amount: number; avgRepairDays: number | null; avgSubmitDays: number | null };

export type DashboardData = {
  months: string[];
  currency: string;
  totals: ClaimKpis & {
    avgSelfAuditDays: number | null;
    avgScrapEvidenceDays: number | null;
    warrantyRoomParts: number;
    flaggedToScrap: number;
    avgClaimValue: number | null;
    adjustedClaimCount: number;
  };
  detectedSplit: { labor: number; part: number; sublet: number };
  costSplit: { part: number; labor: number; sublet: number };
  statusCounts: { label: string; count: number; amount: number }[];
  cycle: {
    repair: CycleMetric;
    submission: CycleMetric;
    selfAudit: CycleMetric;
    scrapEvidence: CycleMetric;
    endToEnd: CycleMetric;
    lifecycle: { stage: string; detail: string; avg: number | null; claims: number }[];
  };
  periods: PeriodPoint[];
  periodUnit: "week" | "month";
  weekdays: WeekdayPoint[];
  topLaborCodes: RankedItem[];
  topVehicles: RankedItem[];
  seriesStats: SeriesStat[];
  slowestClaims: ClaimRow[];
  highValueClaims: ClaimRow[];
  warrantyRoom: {
    parts: number;
    claims: number;
    avgHoldingDays: number | null;
    aging: Bucket[];
    topParts: RankedItem[];
  };
  branchRows: BranchRow[];
  selfAuditScores: ScorePoint[];
  internalAuditScores: ScorePoint[];
  pending: PendingTask[];
};

function computeClaimKpis(claims: DashboardClaim[], days: number): ClaimKpis {
  let totalClaimAmount = 0;
  let totalAdjustedAmount = 0;
  let submitted = 0;
  let firstTimeAccepted = 0;
  const wips = new Set<string>();

  for (const c of claims) {
    const claimTol = num(c.claim_amount) ?? 0;
    totalClaimAmount += claimTol;
    totalAdjustedAmount += num(c.adjusted) ?? claimTol;
    const wip = baseJobCard(c.work_order_no);
    if (wip) wips.add(wip);
    if (c.first_submit) {
      submitted += 1;
      // Return Times(Dealer) is only filled in once SAIC has sent the claim
      // back - blank means it was accepted on the first submission.
      if (!c.return_times_dealer) firstTimeAccepted += 1;
    }
  }

  return {
    claimCount: claims.length,
    totalClaimAmount,
    totalAdjustedAmount,
    detectedAmount: totalAdjustedAmount - totalClaimAmount,
    submittedCount: submitted,
    acceptedFirstTime: firstTimeAccepted,
    topBoxPct: submitted ? (firstTimeAccepted / submitted) * 100 : null,
    avgDailyClaims: days > 0 ? claims.length / days : null,
    workingDays: days,
    wipCount: wips.size,
    claimsPerWip: wips.size ? claims.length / wips.size : null,
    avgRepairCompletionDays: average(claims.map((c) => daysBetween(c.creation_date, c.repair_end_date))),
    avgClaimSubmissionDays: average(claims.map((c) => daysBetween(c.repair_end_date, c.first_submit))),
  };
}

function cycleMetric(values: (number | null)[], bounds: number[]): CycleMetric {
  const nums = finite(values);
  const buckets: Bucket[] = bounds.map((b, i) => ({
    label: i === 0 ? `≤ ${b}d` : `${bounds[i - 1] + 1}–${b}d`,
    count: nums.filter((v) => v <= b && (i === 0 || v > bounds[i - 1])).length,
  }));
  buckets.push({ label: `> ${bounds[bounds.length - 1]}d`, count: nums.filter((v) => v > bounds[bounds.length - 1]).length });
  return { avg: average(nums), median: median(nums), buckets };
}

function rank(
  claims: DashboardClaim[],
  key: (c: DashboardClaim) => string | null,
  sublabel: (c: DashboardClaim) => string | null,
  limit: number
): RankedItem[] {
  const byKey = new Map<string, RankedItem>();
  for (const c of claims) {
    const k = key(c);
    if (!k) continue;
    const item = byKey.get(k) ?? { label: k, sublabel: sublabel(c) ?? undefined, count: 0, amount: 0 };
    item.count += 1;
    item.amount += num(c.claim_amount) ?? 0;
    byKey.set(k, item);
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || b.amount - a.amount).slice(0, limit);
}

function monthLabel(isoDate: string): string {
  return new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const WEEKDAYS = [
  { dow: 6, label: "Sat" },
  { dow: 0, label: "Sun" },
  { dow: 1, label: "Mon" },
  { dow: 2, label: "Tue" },
  { dow: 3, label: "Wed" },
  { dow: 4, label: "Thu" },
];


type BranchClaimRow = ClaimKpis & { branchId: string; name: string; warrantyRoomParts: number; flaggedToScrap: number };

/**
 * The slow, claims-derived half of the dashboard: everything computed from
 * the claims export, the do-not-scrap cache and pending scrap requests.
 * These only change when an officer uploads data (or the scrap cron runs),
 * so the page caches this part - see getCachedClaimSide.
 */
export type ClaimSide = Omit<
  DashboardData,
  "pending" | "selfAuditScores" | "internalAuditScores" | "branchRows" | "totals" | "cycle"
> & {
  totals: Omit<DashboardData["totals"], "avgSelfAuditDays" | "avgScrapEvidenceDays">;
  cycle: Omit<DashboardData["cycle"], "selfAudit" | "scrapEvidence">;
  branchRows: BranchClaimRow[];
};

type Range = { from: string; to: string };

function periodInfo(opts: Range) {
  const months = listMonths(opts.from, opts.to);
  const fromDate = `${opts.from}-01`;
  const toDate = monthEnd(opts.to);
  const today = new Date().toISOString().slice(0, 10);
  const periodEnd = toDate < today ? toDate : today;
  const days = fromDate <= periodEnd ? workingDays(fromDate, periodEnd) : 0;
  return { months, fromDate, toDate, periodEnd, days };
}

/**
 * Callers must have already limited `branches` to what the viewer may see -
 * the page passes a branch admin only their own branch, and this may run on
 * the service-role client (inside the cache, where there's no session).
 */
export async function getClaimSide(
  supabase: Client,
  opts: Range & { branches: { id: string; name: string }[] }
): Promise<ClaimSide> {
  const branchIds = opts.branches.map((b) => b.id);
  const branchName = new Map(opts.branches.map((b) => [b.id, b.name]));
  const { months, fromDate, toDate, periodEnd, days } = periodInfo(opts);

  const [allClaims, doNotScrap, scrapRequests] = await Promise.all([
    fetchClaims(supabase, branchIds, months),
    fetchAllParallel<{
      branch_id: string;
      part_no: string | null;
      part_name: string | null;
      quantity: number | null;
      holding_period_days: number | null;
    }>(
      (q) => q.from("self_audit_do_not_scrap_cache").select("id", { count: "exact", head: true }).in("branch_id", branchIds),
      (from, to) =>
        supabase
          .from("self_audit_do_not_scrap_cache")
          .select("branch_id, part_no, part_name, quantity, holding_period_days")
          .in("branch_id", branchIds)
          .order("id")
          .range(from, to),
      supabase
    ),
    fetchAllParallel<{ branch_id: string }>(
      (q) =>
        q
          .from("self_audit_scrap_requests")
          .select("id", { count: "exact", head: true })
          .in("branch_id", branchIds)
          .eq("status", "pending"),
      (from, to) =>
        supabase
          .from("self_audit_scrap_requests")
          .select("branch_id")
          .in("branch_id", branchIds)
          .eq("status", "pending")
          .order("id")
          .range(from, to),
      supabase
    ),
  ]);

  const claims = allClaims.filter((c) => !UNSUBMITTED_STATUSES.has(c.status ?? ""));
  const claimsByBranch = new Map<string, DashboardClaim[]>();
  for (const c of claims) {
    const list = claimsByBranch.get(c.branch_id) ?? [];
    list.push(c);
    claimsByBranch.set(c.branch_id, list);
  }

  const currencyCounts = new Map<string, number>();
  for (const c of claims) if (c.currency) currencyCounts.set(c.currency, (currencyCounts.get(c.currency) ?? 0) + 1);
  const currency = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "SAR";

  const partsByBranch = new Map<string, number>();
  for (const p of doNotScrap) partsByBranch.set(p.branch_id, (partsByBranch.get(p.branch_id) ?? 0) + (p.quantity ?? 1));
  const flaggedByBranch = new Map<string, number>();
  for (const r of scrapRequests) flaggedByBranch.set(r.branch_id, (flaggedByBranch.get(r.branch_id) ?? 0) + 1);

  const branchRows: BranchClaimRow[] = opts.branches.map((b) => ({
    branchId: b.id,
    name: b.name,
    ...computeClaimKpis(claimsByBranch.get(b.id) ?? [], days),
    warrantyRoomParts: partsByBranch.get(b.id) ?? 0,
    flaggedToScrap: flaggedByBranch.get(b.id) ?? 0,
  }));

  // --- money breakdowns ------------------------------------------------------
  const detectedSplit = { labor: 0, part: 0, sublet: 0 };
  const costSplit = { part: 0, labor: 0, sublet: 0 };
  let adjustedClaimCount = 0;
  const statusMap = new Map<string, { count: number; amount: number }>();
  for (const c of claims) {
    const pb = num(c.part_before) ?? 0;
    const lb = num(c.labor_before) ?? 0;
    const sb = num(c.sublet_before) ?? 0;
    costSplit.part += pb;
    costSplit.labor += lb;
    costSplit.sublet += sb;
    detectedSplit.part += (num(c.part_adjusted) ?? pb) - pb;
    detectedSplit.labor += (num(c.labor_adjusted) ?? lb) - lb;
    detectedSplit.sublet += (num(c.sublet_adjusted) ?? sb) - sb;
    const claimTol = num(c.claim_amount) ?? 0;
    if (Math.abs((num(c.adjusted) ?? claimTol) - claimTol) > 0.005) adjustedClaimCount += 1;
    const s = statusMap.get(c.status ?? "Unknown") ?? { count: 0, amount: 0 };
    s.count += 1;
    s.amount += claimTol;
    statusMap.set(c.status ?? "Unknown", s);
  }
  const statusCounts = [...statusMap.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.count - a.count);

  // --- cycle times -------------------------------------------------------------
  const repairDays = claims.map((c) => daysBetween(c.creation_date, c.repair_end_date));
  const submitDays = claims.map((c) => daysBetween(c.repair_end_date, c.first_submit));
  const verifyDays = claims.map((c) => daysBetween(c.first_submit, c.verification));
  const settleDays = claims.map((c) => daysBetween(c.verification, c.settlement));
  const endToEnd = claims.map((c) => daysBetween(c.creation_date, c.first_submit));
  const cycle = {
    repair: cycleMetric(repairDays, [3, 7, 14]),
    submission: cycleMetric(submitDays, [2, 7, 14]),
    endToEnd: cycleMetric(endToEnd, [7, 14, 30]),
    lifecycle: [
      { stage: "Repair", detail: "Job card open → repair end", avg: average(repairDays), claims: finite(repairDays).length },
      { stage: "Claim submission", detail: "Repair end → first submit", avg: average(submitDays), claims: finite(submitDays).length },
      { stage: "SAIC verification", detail: "First submit → verification date", avg: average(verifyDays), claims: finite(verifyDays).length },
      { stage: "Settlement", detail: "Verification → settlement date", avg: average(settleDays), claims: finite(settleDays).length },
    ],
  };

  // --- claimed vs adjusted over time: weeks (Sat-start) for short ranges, months otherwise
  const periodUnit: "week" | "month" = months.length <= 2 ? "week" : "month";
  const periodMap = new Map<string, PeriodPoint>();
  if (periodUnit === "month") for (const m of months) periodMap.set(m, { label: m, claimed: 0, adjusted: 0, count: 0 });
  for (const c of claims) {
    const d = isoDate(c.repair_end_date);
    if (!d) continue;
    let key = d.slice(0, 7);
    if (periodUnit === "week") {
      const t = toUtcMs(d);
      const dow = new Date(t).getUTCDay();
      key = new Date(t - ((dow + 1) % 7) * DAY_MS).toISOString().slice(0, 10); // back to Saturday
    }
    const p = periodMap.get(key) ?? { label: key, claimed: 0, adjusted: 0, count: 0 };
    const claimTol = num(c.claim_amount) ?? 0;
    p.claimed += claimTol;
    p.adjusted += num(c.adjusted) ?? claimTol;
    p.count += 1;
    periodMap.set(key, p);
  }
  const periods = [...periodMap.values()].sort((a, b) => a.label.localeCompare(b.label));

  // --- weekday rhythm: claims repaired and submitted per work-week day ---------
  const dayCounts = new Map<number, number>();
  for (let t = toUtcMs(fromDate); t <= toUtcMs(periodEnd); t += DAY_MS) {
    const dow = new Date(t).getUTCDay();
    dayCounts.set(dow, (dayCounts.get(dow) ?? 0) + 1);
  }
  const weekdays: WeekdayPoint[] = WEEKDAYS.map(({ dow, label }) => ({
    dow,
    label,
    days: dayCounts.get(dow) ?? 0,
    repaired: claims.filter((c) => c.repair_end_date && new Date(toUtcMs(c.repair_end_date)).getUTCDay() === dow).length,
    submitted: claims.filter((c) => {
      const d = isoDate(c.first_submit);
      return d && d >= fromDate && d <= toDate && new Date(toUtcMs(d)).getUTCDay() === dow;
    }).length,
  }));

  // --- per vehicle series --------------------------------------------------------
  const seriesMap = new Map<string, DashboardClaim[]>();
  for (const c of claims) if (c.series) seriesMap.set(c.series, [...(seriesMap.get(c.series) ?? []), c]);
  const seriesStats: SeriesStat[] = [...seriesMap.entries()]
    .map(([series, list]) => ({
      series,
      count: list.length,
      amount: list.reduce((s, c) => s + (num(c.claim_amount) ?? 0), 0),
      avgRepairDays: average(list.map((c) => daysBetween(c.creation_date, c.repair_end_date))),
      avgSubmitDays: average(list.map((c) => daysBetween(c.repair_end_date, c.first_submit))),
    }))
    .sort((a, b) => b.count - a.count);

  const toRow = (c: DashboardClaim): ClaimRow => {
    const claimTol = num(c.claim_amount) ?? 0;
    return {
      claimNumber: c.claim_number,
      workOrderNo: c.work_order_no,
      vin: c.vin,
      branch: branchName.get(c.branch_id) ?? "",
      series: c.series,
      laborName: c.labor_name,
      partName: c.part_name,
      status: c.status,
      amount: claimTol,
      adjusted: num(c.adjusted) ?? claimTol,
      openDate: c.creation_date,
      repairEnd: c.repair_end_date,
      firstSubmit: isoDate(c.first_submit),
      repairDays: daysBetween(c.creation_date, c.repair_end_date),
      submitDays: daysBetween(c.repair_end_date, c.first_submit),
    };
  };
  const rows = claims.map(toRow);
  const slowestClaims = [...rows]
    .filter((r) => r.repairDays != null)
    .sort((a, b) => (b.repairDays ?? 0) + (b.submitDays ?? 0) - ((a.repairDays ?? 0) + (a.submitDays ?? 0)))
    .slice(0, 10);
  const highValueClaims = [...rows].sort((a, b) => b.amount - a.amount).slice(0, 10);

  // --- warranty room -------------------------------------------------------------
  // holding_period_days counts toward the 90-day hold before a part can be scrapped.
  const agingBounds = [
    { label: "0–29 days", test: (d: number) => d < 30 },
    { label: "30–59 days", test: (d: number) => d >= 30 && d < 60 },
    { label: "60–90 days", test: (d: number) => d >= 60 },
  ];
  const aging: Bucket[] = agingBounds.map((b) => ({
    label: b.label,
    count: doNotScrap.filter((p) => b.test(p.holding_period_days ?? 0)).reduce((s, p) => s + (p.quantity ?? 1), 0),
  }));
  const partMap = new Map<string, RankedItem>();
  for (const p of doNotScrap) {
    const k = p.part_name ?? p.part_no ?? "Unknown part";
    const item = partMap.get(k) ?? { label: k, sublabel: p.part_no ?? undefined, count: 0, amount: 0 };
    item.count += p.quantity ?? 1;
    partMap.set(k, item);
  }
  const totals = computeClaimKpis(claims, days);
  return {
    months,
    currency,
    totals: {
      ...totals,
      warrantyRoomParts: [...partsByBranch.values()].reduce((s, v) => s + v, 0),
      flaggedToScrap: scrapRequests.length,
      avgClaimValue: totals.claimCount ? totals.totalClaimAmount / totals.claimCount : null,
      adjustedClaimCount,
    },
    detectedSplit,
    costSplit,
    statusCounts,
    cycle,
    periods,
    periodUnit,
    weekdays,
    topLaborCodes: rank(claims, (c) => c.labor_code, (c) => c.labor_name, 20),
    topVehicles: rank(claims, (c) => c.series, () => null, 10),
    seriesStats,
    slowestClaims,
    highValueClaims,
    warrantyRoom: {
      parts: [...partsByBranch.values()].reduce((s, v) => s + v, 0),
      claims: doNotScrap.length,
      avgHoldingDays: average(doNotScrap.map((p) => p.holding_period_days)),
      aging,
      topParts: [...partMap.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    },
    branchRows,
  };
}

/**
 * Everything the KPI dashboard shows: the (possibly cached) claims side
 * merged with the live side - audit cycles, assignments, scores, evidence -
 * which is cheap and must reflect a task the moment it's done. The live side
 * runs on the caller's own RLS-scoped client.
 */
export async function getDashboardData(
  supabase: Client,
  opts: Range & { branches: { id: string; name: string }[] },
  claimSidePromise: Promise<ClaimSide>
): Promise<DashboardData> {
  const branchIds = opts.branches.map((b) => b.id);
  const { months } = periodInfo(opts);

  const [
    side,
    { data: cycles },
    { data: assignments },
    { data: results },
    { data: historical },
    { data: internalAudits },
    { data: wrCycles },
    { data: evidence },
  ] = await Promise.all([
    claimSidePromise,
    supabase.from("self_audit_audit_cycles").select("id, cycle_month, claims_month, status, deadline_at, created_at"),
    supabase
      .from("self_audit_audit_assignments")
      .select("id, cycle_id, branch_id, status, created_at, submitted_at")
      .in("branch_id", branchIds),
    supabase.from("self_audit_audit_results").select("cycle_id, branch_id, score_pct").in("branch_id", branchIds),
    supabase
      .from("self_audit_historical_audits")
      .select("audit_type, branch_id, period_month, score_pct")
      .in("branch_id", branchIds),
    supabase
      .from("self_audit_internal_audits")
      .select("branch_id, audit_date, finalized_at, score_pct, status")
      .eq("status", "finalized")
      .in("branch_id", branchIds),
    supabase.from("self_audit_warranty_room_cycles").select("id, cycle_month, status, created_at"),
    supabase
      .from("self_audit_destroy_evidence")
      .select("cycle_id, branch_id, status, submitted_at")
      .in("branch_id", branchIds),
  ]);

  // Self audit submission days = admin completion date - officer generate
  // date, for the cycles auditing claims from the selected months.
  const cycleById = new Map((cycles ?? []).map((c) => [c.id, c]));
  const selfAuditDays = (assignments ?? [])
    .filter((a) => {
      const cycle = cycleById.get(a.cycle_id);
      return a.submitted_at && cycle && months.includes(cycle.claims_month.slice(0, 7));
    })
    .map((a) => ({ branchId: a.branch_id, days: daysBetween(a.created_at, a.submitted_at) }));

  // Scrap evidence submission days = evidence submission date - officer
  // generate date of that warranty room cycle.
  const wrCycleById = new Map((wrCycles ?? []).map((c) => [c.id, c]));
  const scrapEvidenceDays = (evidence ?? [])
    .filter((e) => e.submitted_at && wrCycleById.has(e.cycle_id))
    .map((e) => ({ branchId: e.branch_id, days: daysBetween(wrCycleById.get(e.cycle_id)!.created_at, e.submitted_at) }));

  const branchRows: BranchRow[] = side.branchRows.map((r) => ({
    ...r,
    avgSelfAuditDays: average(selfAuditDays.filter((d) => d.branchId === r.branchId).map((d) => d.days)),
    avgScrapEvidenceDays: average(scrapEvidenceDays.filter((d) => d.branchId === r.branchId).map((d) => d.days)),
  }));

  // Score trends are all-time (not limited to the month filter) - a trend
  // line over one or two months says nothing.
  const selfAuditScores: ScorePoint[] = [
    ...(results ?? []).flatMap((r) => {
      const cycle = cycleById.get(r.cycle_id);
      return cycle ? [{ month: cycle.cycle_month.slice(0, 7), branchId: r.branch_id, score: Number(r.score_pct) }] : [];
    }),
    ...(historical ?? [])
      .filter((h) => h.audit_type === "self_audit")
      .map((h) => ({ month: h.period_month.slice(0, 7), branchId: h.branch_id, score: Number(h.score_pct) })),
  ];
  const internalAuditScores: ScorePoint[] = [
    ...(internalAudits ?? []).flatMap((a) => {
      const date = a.audit_date ?? a.finalized_at;
      return a.branch_id && date && a.score_pct != null ? [{ month: date.slice(0, 7), branchId: a.branch_id, score: Number(a.score_pct) }] : [];
    }),
    ...(historical ?? [])
      .filter((h) => h.audit_type === "internal_audit")
      .map((h) => ({ month: h.period_month.slice(0, 7), branchId: h.branch_id, score: Number(h.score_pct) })),
  ];

  // Pending tasks: the latest open self-audit cycle and warranty room cycle.
  const openCycle = (cycles ?? [])
    .filter((c) => c.status === "open")
    .sort((a, b) => b.cycle_month.localeCompare(a.cycle_month))[0];
  const openWrCycle = (wrCycles ?? [])
    .filter((c) => c.status === "open")
    .sort((a, b) => b.cycle_month.localeCompare(a.cycle_month))[0];

  const pending: PendingTask[] = opts.branches.map((b) => {
    const branchAssignments = openCycle
      ? (assignments ?? []).filter((a) => a.cycle_id === openCycle.id && a.branch_id === b.id)
      : [];
    const ev = openWrCycle ? (evidence ?? []).find((e) => e.cycle_id === openWrCycle.id && e.branch_id === b.id) : undefined;
    const pendingAssignments = branchAssignments.filter((a) => a.status === "not_started" || a.status === "in_progress");
    return {
      branchId: b.id,
      name: b.name,
      selfAudit:
        openCycle && branchAssignments.length
          ? {
              cycleId: openCycle.id,
              cycleLabel: monthLabel(openCycle.cycle_month),
              pending: pendingAssignments.length,
              firstPendingAssignmentId: pendingAssignments[0]?.id ?? null,
              total: branchAssignments.length,
              deadline: openCycle.deadline_at,
              generatedAt: openCycle.created_at,
            }
          : null,
      scrapEvidence: openWrCycle
        ? {
            cycleId: openWrCycle.id,
            cycleLabel: monthLabel(openWrCycle.cycle_month),
            // "sent" is the officer's approval (approve_destroy_evidence).
            status: ev?.status === "sent" ? "approved" : ev?.status === "submitted" ? "submitted" : "not_submitted",
            generatedAt: openWrCycle.created_at,
          }
        : null,
    };
  });

  return {
    ...side,
    totals: {
      ...side.totals,
      avgSelfAuditDays: average(selfAuditDays.map((d) => d.days)),
      avgScrapEvidenceDays: average(scrapEvidenceDays.map((d) => d.days)),
    },
    cycle: {
      ...side.cycle,
      selfAudit: cycleMetric(selfAuditDays.map((d) => d.days), [3, 7, 14]),
      scrapEvidence: cycleMetric(scrapEvidenceDays.map((d) => d.days), [7, 14, 30]),
    },
    branchRows,
    selfAuditScores,
    internalAuditScores,
    pending,
  };
}
