import { requireRole } from "@/lib/auth";
import { CourtesyView } from "@/components/courtesy/courtesy-view";

export default async function CourtesyCarsPage() {
  await requireRole("officer");
  return (
    <div className="relative left-1/2 w-[min(90rem,calc(100vw-var(--sidebar-w,0px)-2rem))] -translate-x-1/2">
      <CourtesyView />
    </div>
  );
}
