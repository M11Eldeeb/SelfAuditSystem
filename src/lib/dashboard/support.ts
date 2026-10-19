import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type LeadStat = {
  /** Requests submitted in the period. */
  submitted: number;
  /** Of those, how many are finished (closed / rejected / cancelled). */
  finished: number;
  /** Still waiting now. */
  open: number;
  /** Average / median hours from submission to closure, over the finished ones. */
  avgHours: number | null;
  medianHours: number | null;
  /** Share closed within 24 hours, over the finished ones. */
  within24hPct: number | null;
  /** Oldest request still waiting, in hours. */
  oldestOpenHours: number | null;
};

export type SupportLeadTimes = { inquiries: LeadStat; codes: LeadStat };

const HOUR = 3_600_000;

function stat(rows: { start: string; end: string | null; open: boolean }[]): LeadStat {
  const done = rows.filter((r) => r.end).map((r) => (Date.parse(r.end!) - Date.parse(r.start)) / HOUR).filter((h) => h >= 0).sort((a, b) => a - b);
  const now = Date.now();
  const openAges = rows.filter((r) => r.open).map((r) => (now - Date.parse(r.start)) / HOUR);
  return {
    submitted: rows.length,
    finished: done.length,
    open: openAges.length,
    avgHours: done.length ? done.reduce((s, h) => s + h, 0) / done.length : null,
    medianHours: done.length ? done[Math.floor((done.length - 1) / 2)] : null,
    within24hPct: done.length ? (done.filter((h) => h <= 24).length / done.length) * 100 : null,
    oldestOpenHours: openAges.length ? Math.max(...openAges) : null,
  };
}

/**
 * Closure lead time of Technical Inquiries (submitted - or verified, for a team leader's case - until closed) and
 * Verification Code requests (submitted until the code is sent or the request is rejected), for requests submitted
 * in the dashboard's months and branches.
 */
export async function getSupportLeadTimes(branchIds: string[], from: string, to: string): Promise<SupportLeadTimes> {
  const admin = createAdminClient();
  const start = `${from}-01T00:00:00+03:00`;
  const [y, m] = to.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 1) - 3 * HOUR).toISOString(); // first day after `to`, Riyadh time
  const empty = stat([]);
  if (!branchIds.length) return { inquiries: empty, codes: empty };

  const [{ data: inquiries }, { data: codes }] = await Promise.all([
    admin
      .from("self_audit_technical_inquiries")
      .select("created_at, verified_at, closed_at, status")
      .in("branch_id", branchIds)
      .gte("created_at", start)
      .lt("created_at", end)
      .neq("status", "pending_verification"),
    admin
      .from("self_audit_verification_requests")
      .select("created_at, closed_at, status")
      .in("branch_id", branchIds)
      .gte("created_at", start)
      .lt("created_at", end),
  ]);

  return {
    inquiries: stat(
      (inquiries ?? [])
        .filter((i) => i.status !== "cancelled")
        .map((i) => ({ start: i.verified_at ?? i.created_at, end: i.status === "closed" ? i.closed_at : null, open: i.status === "open" || i.status === "awaiting_workshop" }))
    ),
    codes: stat((codes ?? []).map((c) => ({ start: c.created_at, end: c.status === "open" ? null : c.closed_at, open: c.status === "open" }))),
  };
}
