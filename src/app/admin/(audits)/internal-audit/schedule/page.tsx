import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { linkScheduledAudits, todayKsa } from "@/lib/ia-schedule";
import { ScheduleBoard, type ScheduleData } from "./schedule-board";

/** Internal audit schedule: how many audits each branch gets this year, their dates, and the holidays to avoid. */
export default async function InternalAuditSchedulePage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requireRole("officer");
  const today = todayKsa();
  const thisYear = Number(today.slice(0, 4));
  const asked = Number((await searchParams).year);
  const year = Number.isInteger(asked) && asked >= 2024 && asked <= thisYear + 2 ? asked : thisYear;

  await linkScheduledAudits(year);
  const admin = createAdminClient();
  const [{ data: branches }, { data: slots }, { data: holidays }] = await Promise.all([
    admin.from("self_audit_branches").select("id, name, code").eq("active", true).order("name"),
    admin.from("self_audit_ia_schedule").select("id, branch_id, slot, planned_date, days, internal_audit_id").eq("year", year).order("slot"),
    admin.from("self_audit_holidays").select("id, day, name, official").gte("day", `${year}-01-01`).lte("day", `${year}-12-31`).order("day"),
  ]);
  const auditIds = (slots ?? []).map((s) => s.internal_audit_id).filter((id): id is string => !!id);
  const { data: audits } = auditIds.length ? await admin.from("self_audit_internal_audits").select("id, name, status").in("id", auditIds) : { data: [] };
  const auditOf = new Map((audits ?? []).map((a) => [a.id, a]));

  const data: ScheduleData = {
    year,
    today,
    branches: (branches ?? []).map((b) => ({ id: b.id, name: b.name, code: b.code })),
    slots: (slots ?? []).map((s) => {
      const a = s.internal_audit_id ? auditOf.get(s.internal_audit_id) : null;
      return { id: s.id, branchId: s.branch_id, slot: s.slot, date: s.planned_date, days: s.days, audit: a ? { id: a.id, name: a.name ?? "Internal audit", finalized: a.status === "finalized" } : null };
    }),
    holidays: (holidays ?? []).map((h) => ({ id: h.id, day: h.day, name: h.name, official: h.official })),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Internal Audit Schedule</h1>
          <p className="text-sm text-neutral-600">Set how many audits each branch gets this year (up to 4) and pick the dates. A reminder to create the audit list goes to the officers before each date.</p>
        </div>
        <div className="inline-flex gap-1 rounded-lg bg-neutral-100 p-1">
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
            <Link
              key={y}
              href={`/admin/internal-audit/schedule?year=${y}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${y === year ? "bg-white text-neutral-900 shadow-sm ring-1 ring-black/5" : "text-neutral-600 hover:text-neutral-900"}`}
            >
              {y}
            </Link>
          ))}
        </div>
      </div>
      <ScheduleBoard data={data} />
    </div>
  );
}
