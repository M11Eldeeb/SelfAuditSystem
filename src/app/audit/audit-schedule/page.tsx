import { requireRole } from "@/lib/auth";
import { BranchSchedule } from "@/components/audit-schedule/branch-schedule";

/** Warranty admin (and the service manager, read only): the internal audit schedule of the branch. */
export default async function BranchAuditSchedulePage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const user = await requireRole("branch_admin");
  const { year } = await searchParams;
  return <BranchSchedule user={user} base="/audit/audit-schedule" yearParam={year} />;
}
