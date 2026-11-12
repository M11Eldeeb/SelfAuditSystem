import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { QueryView } from "@/components/query/query-view";

/** Query: one search for everything about a WIP, VIN, plate or claim (every branch) - warranty officers and national managers. */
export default async function OfficerQueryPage({ searchParams }: { searchParams: Promise<{ q?: string; branch?: string }> }) {
  const user = await requireRole("officer");
  if (user.managerKind === "manager") redirect("/admin/dashboard");
  const { q, branch } = await searchParams;
  return <QueryView initialQuery={q ?? ""} initialBranch={branch ?? null} />;
}
