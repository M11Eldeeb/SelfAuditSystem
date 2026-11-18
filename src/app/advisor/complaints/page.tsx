import { requireAdvisorArea } from "@/lib/reception";
import { ComplaintsView } from "@/components/complaints/complaints-view";

export default async function AdvisorComplaintsPage() {
  await requireAdvisorArea();
  return (
    <div className="relative left-1/2 w-[min(84rem,calc(100vw-var(--sidebar-w,0px)-2rem))] -translate-x-1/2">
      <ComplaintsView />
    </div>
  );
}
