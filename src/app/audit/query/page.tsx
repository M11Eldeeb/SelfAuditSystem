import { requireRole } from "@/lib/auth";
import { QueryView } from "@/components/query/query-view";

/** Query: one search for everything about a WIP, VIN, plate or claim of this branch. */
export default async function BranchQueryPage({ searchParams }: { searchParams: Promise<{ q?: string; branch?: string }> }) {
  await requireRole("branch_admin");
  const { q, branch } = await searchParams;
  return <QueryView initialQuery={q ?? ""} initialBranch={branch ?? null} />;
}
