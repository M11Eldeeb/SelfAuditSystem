import { requireRole } from "@/lib/auth";
import { CourtesyCarsPage } from "@/components/courtesy/agreements-page";

/** Courtesy cars: the agreements made in the portal (customer link, handover, return) and the fleet sheet. */
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string }> }) {
  await requireRole("branch_admin");
  const { tab, status } = await searchParams;
  return (
    <div className="relative left-1/2 w-[min(90rem,calc(100vw-var(--sidebar-w,0px)-2rem))] -translate-x-1/2">
      <CourtesyCarsPage base="/audit/courtesy-cars" tab={tab} status={status} />
    </div>
  );
}
