import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { baseJobCard, listMonths } from "@/lib/dashboard/kpis";
import { shiftMonth } from "@/lib/month";

type Client = SupabaseClient<Database>;

/**
 * Light claim rows - real columns only (no raw_row), so a 7-month window of
 * every branch stays cheap to read.
 */
type TrendClaim = {
  branch_id: string;
  claim_number: string;
  work_order_no: string | null;
  vin: string | null;
  vehicle_model: string | null;
  mileage: number | null;
  labor_code: string | null;
  main_part_name: string | null;
  repair_end_date: string | null;
  claim_amount: number | null;
};

const TREND_SELECT =
  "branch_id, claim_number, work_order_no, vin, vehicle_model, mileage, labor_code, main_part_name, repair_end_date, claim_amount";

/** Months of history each code is compared against. */
export const BASELINE_MONTHS = 6;

export type TrendItem = {
  key: string;
  current: number;
  currentAmount: number;
  baseline: number;
  /** Claims per month in the selected period vs the baseline months. */
  currentPerMonth: number;
  baselinePerMonth: number;
  /** currentPerMonth / baselinePerMonth; null when the code is new. */
  ratio: number | null;
  isNew: boolean;
  monthly: { month: string; count: number }[];
  models: { model: string; count: number }[];
  branches: { name: string; count: number }[];
};

export type RepeatRow = {
  kind: "duplicate" | "repeat";
  vin: string;
  model: string | null;
  laborCode: string;
  partName: string | null;
  branch: string;
  first: { claimNumber: string; workOrderNo: string | null; date: string | null; mileage: number | null };
  second: { claimNumber: string; workOrderNo: string | null; date: string | null; mileage: number | null };
  daysBetween: number | null;
  kmBetween: number | null;
  amount: number;
};

export type TrendData = {
  baselineMonths: string[];
  currentMonths: string[];
  labor: TrendItem[];
  parts: TrendItem[];
  repeats: RepeatRow[];
};

const PAGE = 1000;

async function fetchSlice(supabase: Client, branchId: string, month: string): Promise<TrendClaim[]> {
  const [y, m] = month.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const rows: TrendClaim[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("self_audit_claims")
      .select(TREND_SELECT)
      .eq("branch_id", branchId)
      .gte("repair_end_date", `${month}-01`)
      .lte("repair_end_date", end)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message || "Timed out loading claims.");
    const page = (data ?? []) as TrendClaim[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

async function fetchWindow(supabase: Client, branchIds: string[], months: string[]): Promise<TrendClaim[]> {
  const tasks = branchIds.flatMap((b) => months.map((m) => () => fetchSlice(supabase, b, m)));
  const results: TrendClaim[][] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await tasks[i]();
      }
    })
  );
  return results.flat();
}

function buildTrends(
  rows: TrendClaim[],
  key: (c: TrendClaim) => string | null,
  currentMonths: string[],
  baselineMonths: string[],
  branchName: Map<string, string>
): TrendItem[] {
  const allMonths = [...baselineMonths, ...currentMonths];
  const currentSet = new Set(currentMonths);
  const groups = new Map<string, TrendClaim[]>();
  for (const c of rows) {
    const k = key(c);
    if (!k) continue;
    const list = groups.get(k);
    if (list) list.push(c);
    else groups.set(k, [c]);
  }

  const items: TrendItem[] = [];
  for (const [k, list] of groups) {
    const cur = list.filter((c) => c.repair_end_date && currentSet.has(c.repair_end_date.slice(0, 7)));
    if (cur.length === 0) continue;
    const baseline = list.length - cur.length;
    const currentPerMonth = cur.length / currentMonths.length;
    const baselinePerMonth = baseline / baselineMonths.length;
    const tally = (f: (c: TrendClaim) => string) => {
      const m = new Map<string, number>();
      for (const c of cur) m.set(f(c), (m.get(f(c)) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    items.push({
      key: k,
      current: cur.length,
      currentAmount: cur.reduce((s, c) => s + (Number(c.claim_amount) || 0), 0),
      baseline,
      currentPerMonth,
      baselinePerMonth,
      ratio: baseline ? currentPerMonth / baselinePerMonth : null,
      isNew: baseline === 0,
      monthly: allMonths.map((month) => ({ month, count: list.filter((c) => c.repair_end_date?.startsWith(month)).length })),
      models: tally((c) => c.vehicle_model ?? "Unknown").slice(0, 4).map(([model, count]) => ({ model, count })),
      branches: tally((c) => branchName.get(c.branch_id) ?? "").slice(0, 4).map(([name, count]) => ({ name, count })),
    });
  }
  return items;
}

/**
 * Trend + repeat-repair signals for the officer: every labor code and main
 * part with claims in the selected repair-end months, compared to its own
 * monthly average over the BASELINE_MONTHS before them, plus VINs that came
 * back for the same labor code. Callers pass only branches the viewer may
 * see (officer-only page).
 */
export async function getTrendData(
  supabase: Client,
  opts: { branches: { id: string; name: string }[]; from: string; to: string }
): Promise<TrendData> {
  const currentMonths = listMonths(opts.from, opts.to);
  const baselineMonths = listMonths(shiftMonth(opts.from, -BASELINE_MONTHS).slice(0, 7), shiftMonth(opts.from, -1).slice(0, 7));
  const branchName = new Map(opts.branches.map((b) => [b.id, b.name]));
  const rows = await fetchWindow(
    supabase,
    opts.branches.map((b) => b.id),
    [...baselineMonths, ...currentMonths]
  );

  // Only codes with at least 2 claims in the period can be a pattern; the
  // strongest 150 by excess over baseline are plenty for the page.
  const strongest = (items: TrendItem[]) =>
    items
      .filter((i) => i.current >= 2)
      .sort((a, b) => b.currentPerMonth - b.baselinePerMonth - (a.currentPerMonth - a.baselinePerMonth))
      .slice(0, 150);
  const labor = strongest(buildTrends(rows, (c) => c.labor_code, currentMonths, baselineMonths, branchName));
  const parts = strongest(buildTrends(rows, (c) => c.main_part_name, currentMonths, baselineMonths, branchName));

  // Same VIN + same labor code more than once in the window, where the later
  // claim is in the selected period. Same base job card = possibly the same
  // repair claimed twice; a different job card = the car came back.
  const currentSet = new Set(currentMonths);
  const byVinLabor = new Map<string, TrendClaim[]>();
  for (const c of rows) {
    if (!c.vin || !c.labor_code) continue;
    const k = `${c.vin}|${c.labor_code}`;
    const list = byVinLabor.get(k);
    if (list) list.push(c);
    else byVinLabor.set(k, [c]);
  }
  const repeats: RepeatRow[] = [];
  for (const list of byVinLabor.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => (a.repair_end_date ?? "").localeCompare(b.repair_end_date ?? "") || a.claim_number.localeCompare(b.claim_number));
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const curr = list[i];
      if (!curr.repair_end_date || !currentSet.has(curr.repair_end_date.slice(0, 7))) continue;
      const sameCard = baseJobCard(prev.work_order_no) != null && baseJobCard(prev.work_order_no) === baseJobCard(curr.work_order_no);
      repeats.push({
        kind: sameCard ? "duplicate" : "repeat",
        vin: curr.vin!,
        model: curr.vehicle_model,
        laborCode: curr.labor_code!,
        partName: curr.main_part_name,
        branch: branchName.get(curr.branch_id) ?? "",
        first: { claimNumber: prev.claim_number, workOrderNo: prev.work_order_no, date: prev.repair_end_date, mileage: prev.mileage },
        second: { claimNumber: curr.claim_number, workOrderNo: curr.work_order_no, date: curr.repair_end_date, mileage: curr.mileage },
        daysBetween:
          prev.repair_end_date && curr.repair_end_date
            ? Math.round((Date.parse(curr.repair_end_date) - Date.parse(prev.repair_end_date)) / 86_400_000)
            : null,
        kmBetween: prev.mileage != null && curr.mileage != null ? Number(curr.mileage) - Number(prev.mileage) : null,
        amount: Number(curr.claim_amount) || 0,
      });
    }
  }
  repeats.sort((a, b) => (a.kind === b.kind ? (a.daysBetween ?? 0) - (b.daysBetween ?? 0) : a.kind === "duplicate" ? -1 : 1));

  return { baselineMonths, currentMonths, labor, parts, repeats };
}
