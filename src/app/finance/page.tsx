import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFinanceSummary } from "@/lib/dashboard/finance";
import { FinanceReport } from "@/components/dashboard/finance-report";

export default async function FinancePage() {
  await requireRole("finance");
  const { months, currency } = await getFinanceSummary(await createClient());
  return <FinanceReport months={months} currency={currency} />;
}
