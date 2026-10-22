import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Today in Saudi time, YYYY-MM-DD. */
export const todayKsa = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

const LINK_WINDOW_DAYS = 31;
const daysBetween = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/**
 * Links planned audits to the internal audits created for them: an audit of the same branch whose audit date (or, without
 * one, creation date) is within a month of the planned date, not linked to another planned audit yet - the nearest wins.
 */
export async function linkScheduledAudits(year?: number): Promise<void> {
  const admin = createAdminClient();
  let q = admin.from("self_audit_ia_schedule").select("id, branch_id, planned_date, internal_audit_id").is("internal_audit_id", null).not("planned_date", "is", null);
  if (year) q = q.eq("year", year);
  const { data: open } = await q;
  if (!open?.length) return;
  const branchIds = [...new Set(open.map((s) => s.branch_id))];
  const [{ data: audits }, { data: linked }] = await Promise.all([
    admin.from("self_audit_internal_audits").select("id, branch_id, audit_date, created_at").in("branch_id", branchIds),
    admin.from("self_audit_ia_schedule").select("internal_audit_id").not("internal_audit_id", "is", null),
  ]);
  const taken = new Set((linked ?? []).map((l) => l.internal_audit_id));
  for (const slot of [...open].sort((a, b) => a.planned_date!.localeCompare(b.planned_date!))) {
    const best = (audits ?? [])
      .filter((a) => a.branch_id === slot.branch_id && !taken.has(a.id))
      .map((a) => ({ id: a.id, gap: daysBetween(a.audit_date ?? a.created_at.slice(0, 10), slot.planned_date!) }))
      .filter((a) => a.gap <= LINK_WINDOW_DAYS)
      .sort((a, b) => a.gap - b.gap)[0];
    if (!best) continue;
    taken.add(best.id);
    await admin.from("self_audit_ia_schedule").update({ internal_audit_id: best.id }).eq("id", slot.id).is("internal_audit_id", null);
  }
}
