import { requireAnyRole } from "@/lib/auth";
import { BranchSchedule } from "@/components/audit-schedule/branch-schedule";

/** Workshop supervisor and team leader: the internal audit schedule of the branch. */
export default async function WorkshopAuditSchedulePage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const user = await requireAnyRole(["workshop_supervisor", "team_leader"]);
  const { year } = await searchParams;
  return <BranchSchedule user={user} base="/workshop/audit-schedule" yearParam={year} />;
}
