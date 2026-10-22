import Link from "next/link";
import type { CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayKsa } from "@/lib/ia-schedule";
import { BranchCalendar } from "./branch-calendar";

/**
 * The internal audit schedule of the user's own branch, read only - for the warranty admin, service manager, workshop
 * supervisor and team leader. (Officers plan it under Audits -> Internal Audit -> Schedule.)
 */
export async function BranchSchedule({ user, base, yearParam }: { user: CurrentUser; base: string; yearParam?: string }) {
  const today = todayKsa();
  const thisYear = Number(today.slice(0, 4));
  const asked = Number(yearParam);
  const year = asked === thisYear + 1 ? asked : thisYear;
  const admin = createAdminClient();
  const branchId = user.branch_id ?? "00000000-0000-0000-0000-000000000000";
  const [{ data: slots }, { data: holidays }, { data: branch }] = await Promise.all([
    admin.from("self_audit_ia_schedule").select("slot, planned_date, days, internal_audit_id").eq("year", year).eq("branch_id", branchId).order("slot"),
    admin.from("self_audit_holidays").select("day, name").gte("day", `${year}-01-01`).lte("day", `${year}-12-31`),
    admin.from("self_audit_branches").select("name").eq("id", branchId).maybeSingle(),
  ]);
  const linked = (slots ?? []).map((s) => s.internal_audit_id).filter((id): id is string => !!id);
  const { data: finalized } = linked.length ? await admin.from("self_audit_internal_audits").select("id").in("id", linked).eq("status", "finalized") : { data: [] };
  const done = new Set((finalized ?? []).map((a) => a.id));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Internal Audit Schedule</h1>
          <p className="text-sm text-neutral-600">{branch?.name}</p>
        </div>
        <div className="inline-flex gap-1 rounded-lg bg-neutral-100 p-1">
          {[thisYear, thisYear + 1].map((y) => (
            <Link
              key={y}
              href={`${base}?year=${y}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${y === year ? "bg-white text-neutral-900 shadow-sm ring-1 ring-black/5" : "text-neutral-600 hover:text-neutral-900"}`}
            >
              {y}
            </Link>
          ))}
        </div>
      </div>
      <BranchCalendar
        year={year}
        today={today}
        audits={(slots ?? []).map((s) => ({ slot: s.slot, date: s.planned_date, days: s.days, done: !!s.internal_audit_id && done.has(s.internal_audit_id) }))}
        holidays={holidays ?? []}
      />
    </div>
  );
}
