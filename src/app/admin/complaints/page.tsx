import { requireRole } from "@/lib/auth";
import { ComplaintsView } from "@/components/complaints/complaints-view";

export default async function AdminComplaintsPage() {
  await requireRole("officer");
  return (
    <div className="relative left-1/2 w-[min(84rem,calc(100vw-var(--sidebar-w,0px)-2rem))] -translate-x-1/2">
      <ComplaintsView />
    </div>
  );
}
