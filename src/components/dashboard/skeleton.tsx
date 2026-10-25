import { CarLoader } from "@/components/spinner";

// Shown instantly while the dashboard's data loads: the car driving in the middle of the page.
export function DashboardSkeleton() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <CarLoader label="Loading the dashboard…" />
    </div>
  );
}
