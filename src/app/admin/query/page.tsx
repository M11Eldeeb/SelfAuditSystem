import { requireRole } from "@/lib/auth";
import { QueryView } from "@/components/query/query-view";

/** Query: one search for everything about a WIP, VIN, plate or claim (every branch). */
export default async function OfficerQueryPage({ searchParams }: { searchParams: Promise<{ q?: string; branch?: string }> }) {
  await requireRole("officer");
  const { q, branch } = await searchParams;
  return <QueryView initialQuery={q ?? ""} initialBranch={branch ?? null} />;
}
