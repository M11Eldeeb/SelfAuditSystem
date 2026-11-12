import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { QueryView } from "@/components/query/query-view";

/** Query: one search for everything about a WIP, VIN, plate or claim of his branch - service managers only. */
export default async function BranchQueryPage({ searchParams }: { searchParams: Promise<{ q?: string; branch?: string }> }) {
  const user = await requireRole("branch_admin");
  if (user.managerKind !== "service_manager") redirect("/audit/dashboard");
  const { q, branch } = await searchParams;
  return <QueryView initialQuery={q ?? ""} initialBranch={branch ?? null} />;
}
