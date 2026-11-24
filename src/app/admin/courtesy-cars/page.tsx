import { requireRole } from "@/lib/auth";
import { CourtesyCarsPage } from "@/components/courtesy/agreements-page";

/** Courtesy cars: the agreements made in the portal (customer link, handover, return) and the fleet sheet. */
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string; f?: string; branch?: string; view?: string }> }) {
  await requireRole("officer");
  const { tab, status, f, branch, view } = await searchParams;
  return (
    <div className="relative left-1/2 w-[min(90rem,calc(100vw-var(--sidebar-w,0px)-2rem))] -translate-x-1/2">
      <CourtesyCarsPage base="/admin/courtesy-cars" tab={tab} status={status} f={f} branch={branch} view={view} />
    </div>
  );
}
