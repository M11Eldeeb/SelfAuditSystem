import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export type SettlementPoint = { month: string; order: string; claims: number; gross: number; adjusted: number };
export type ForecastPoint = { month: string; gross: number; low: number; high: number };
export type SettlementForecast = { history: SettlementPoint[]; forecast: ForecastPoint[]; method: string };

/** "CRSA6P20260901" -> "2026-09" (settlement orders end in their date). */
function orderMonth(order: string): string | null {
  const m = order.match(/(\d{4})(\d{2})\d{2}$/);
  return m ? `${m[1]}-${m[2]}` : null;
}

function addMonths(yyyyMM: string, n: number): string {
  const [y, m] = yyyyMM.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Gross Claim TOL. per monthly SAIC settlement order, plus a 3-month
 * forecast. Service-role client (cached, no session): callers must check
 * the viewer is an officer.
 */
export async function getSettlementForecast(admin: SupabaseClient<Database>): Promise<SettlementForecast> {
  const { data: orders, error } = await admin.rpc("list_settlement_orders");
  if (error) throw new Error(error.message);

  const list = (orders ?? []).map((o) => o.settlement_order);
  const totals: SettlementPoint[] = [];
  let next = 0;
  // One index lookup per order, a few at a time (small database).
  await Promise.all(
    Array.from({ length: Math.min(3, list.length) }, async () => {
      while (next < list.length) {
        const order = list[next++];
        const month = orderMonth(order);
        if (!month) continue;
        const { data, error: e } = await admin.rpc("get_settlement_order_totals", { p_order: order });
        if (e) throw new Error(e.message);
        const r = data?.[0];
        if (r && Number(r.claim_count) > 0)
          totals.push({ month, order, claims: Number(r.claim_count), gross: Number(r.gross_amount), adjusted: Number(r.adjusted_amount) });
      }
    })
  );

  // One point per month (if a month ever had two orders, add them up).
  const byMonth = new Map<string, SettlementPoint>();
  for (const t of totals) {
    const p = byMonth.get(t.month);
    byMonth.set(t.month, p ? { ...p, order: `${p.order}, ${t.order}`, claims: p.claims + t.claims, gross: p.gross + t.gross, adjusted: p.adjusted + t.adjusted } : t);
  }
  const history = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  return { history, ...forecast(history) };
}

/**
 * Trend x seasonality: a least-squares line through the last 12 months,
 * scaled by each calendar month's seasonal index (its average ratio to the
 * 12-month mean in earlier years, kept within 0.75-1.25 so one odd month
 * can't swing it). Band = +/-1.28 x residual std dev (about 80%).
 */
function forecast(history: SettlementPoint[]): { forecast: ForecastPoint[]; method: string } {
  if (history.length < 4) return { forecast: [], method: "Not enough history" };
  const recent = history.slice(-12);
  const n = recent.length;
  const xs = recent.map((_, i) => i);
  const ys = recent.map((p) => p.gross);
  const xm = xs.reduce((s, v) => s + v, 0) / n;
  const ym = ys.reduce((s, v) => s + v, 0) / n;
  const slope = xs.reduce((s, x, i) => s + (x - xm) * (ys[i] - ym), 0) / Math.max(xs.reduce((s, x) => s + (x - xm) ** 2, 0), 1e-9);
  const intercept = ym - slope * xm;

  // Seasonal index per calendar month from full history.
  const ratios = new Map<string, number[]>();
  history.forEach((p, i) => {
    const window = history.slice(Math.max(0, i - 6), i + 6);
    const mean = window.reduce((s, q) => s + q.gross, 0) / window.length;
    if (mean > 0) ratios.set(p.month.slice(5), [...(ratios.get(p.month.slice(5)) ?? []), p.gross / mean]);
  });
  const season = (month: string) => {
    const r = ratios.get(month.slice(5));
    if (!r || r.length < 2) return 1;
    const avg = r.reduce((s, v) => s + v, 0) / r.length;
    return Math.min(1.25, Math.max(0.75, avg));
  };

  const fitted = recent.map((p, i) => (intercept + slope * i) * season(p.month));
  const sd = Math.sqrt(recent.reduce((s, p, i) => s + (p.gross - fitted[i]) ** 2, 0) / Math.max(n - 2, 1));

  const last = history[history.length - 1].month;
  const forecastPoints: ForecastPoint[] = [1, 2, 3].map((k) => {
    const month = addMonths(last, k);
    const gross = Math.max(0, (intercept + slope * (n - 1 + k)) * season(month));
    const spread = 1.28 * sd * Math.sqrt(1 + k / n);
    return { month, gross, low: Math.max(0, gross - spread), high: gross + spread };
  });
  return { forecast: forecastPoints, method: "12-month trend × seasonal pattern, 80% range" };
}
