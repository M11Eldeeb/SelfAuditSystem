import { requireAdvisorArea } from "@/lib/reception";
import { CourtesyView } from "@/components/courtesy/courtesy-view";

export default async function AdvisorCourtesyCarsPage() {
  await requireAdvisorArea();
  return (
    <div className="relative left-1/2 w-[min(90rem,calc(100vw-var(--sidebar-w,0px)-2rem))] -translate-x-1/2">
      <CourtesyView />
    </div>
  );
}
