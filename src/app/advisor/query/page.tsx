import { redirect } from "next/navigation";
import { requireAdvisorArea, isReception } from "@/lib/reception";
import { QueryView } from "@/components/query/query-view";

/** Query for the customer queue's reception team: everything about a WIP, VIN, plate or claim of their branch. */
export default async function ReceptionQueryPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireAdvisorArea();
  if (!isReception(user)) redirect("/advisor/dashboard");
  const { q } = await searchParams;
  return <QueryView initialQuery={q ?? ""} initialBranch={null} />;
}
