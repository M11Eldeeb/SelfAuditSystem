import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";

// The QC analysis is the Quality Dashboard tab of the dashboard now (one page, one set of numbers): old links and bookmarks land there.
export default async function QualityControlAnalysisPage({ searchParams }: { searchParams: Promise<{ qc?: string; branch?: string }> }) {
  await requireRole("branch_admin");
  const p = await searchParams;
  const q = new URLSearchParams({ tab: "quality" });
  for (const k of ["qc", "branch"] as const) if (p[k]) q.set(k, p[k]);
  redirect(`/audit/dashboard?${q}`);
}
