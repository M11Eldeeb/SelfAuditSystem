"use client";

import { DashboardError } from "@/components/dashboard/dashboard-error";

export default function DashboardErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <DashboardError retry={retry} />;
}
