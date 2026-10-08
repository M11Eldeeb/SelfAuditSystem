import { requireRole } from "@/lib/auth";
import { PartReturnPrintPage } from "@/components/part-returns/print-page";

export default async function BranchPartReturnPrint({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ items?: string }>;
}) {
  await requireRole("branch_admin");
  const [{ id }, { items }] = await Promise.all([params, searchParams]);
  return <PartReturnPrintPage id={id} itemsParam={items} />;
}
