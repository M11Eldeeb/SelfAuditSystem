import { requireRole } from "@/lib/auth";
import { PartReturnPrintPage } from "@/components/part-returns/print-page";

export default async function AdminPartReturnPrint({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ items?: string }>;
}) {
  await requireRole("officer");
  const [{ id }, { items }] = await Promise.all([params, searchParams]);
  return <PartReturnPrintPage id={id} itemsParam={items} />;
}
