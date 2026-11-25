import { CourtesyCarsPage } from "@/components/courtesy/agreements-page";
import { requireWorkshopCourtesy } from "./access";

/** Courtesy cars for a workshop account given courtesy car access: hand over and take back cars of his branch. */
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string; f?: string; branch?: string; view?: string }> }) {
  await requireWorkshopCourtesy();
  const { tab, status, f, branch, view } = await searchParams;
  return (
    <div className="relative left-1/2 w-[min(90rem,calc(100vw-var(--sidebar-w,0px)-2rem))] -translate-x-1/2">
      <CourtesyCarsPage base="/workshop/courtesy-cars" tab={tab ?? "agreements"} status={status} f={f} branch={branch} view={view} />
    </div>
  );
}
