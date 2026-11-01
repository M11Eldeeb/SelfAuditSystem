import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isOnOrAfterReconStart } from "@/lib/dashboard/recon-constants";
import { displayFont } from "@/components/dashboard/font";
import { ReconciliationTabs, type ReconciliationView } from "@/components/dashboard/reconciliation-tabs";

const VIEWS: ReconciliationView[] = ["settlement", "rejected", "invoicing", "tracked"];

/** Reconciliation (officers): settled claims per settlement number, rejected claims, claims vs invoicing, claims to review. */
export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireRole("officer");
  const { view } = await searchParams;
  const supabase = await createClient();
  const [{ data: branches }, { data: orders }, { data: cur }] = await Promise.all([
    supabase.from("self_audit_branches").select("id, name").order("name"),
    supabase.rpc("get_settlement_orders"),
    supabase.from("self_audit_claims").select("currency:raw_row->>currency").not("raw_row->>currency", "is", null).limit(1).maybeSingle(),
  ]);
  const currency = (cur as { currency?: string } | null)?.currency || "USD";
  return (
    <div className={`${displayFont.variable} relative left-1/2 w-[min(96rem,calc(100vw-var(--sidebar-w,0px)-2rem))] -translate-x-1/2 space-y-5`}>
      <header className="px-1">
        <h1 className="text-[28px] leading-tight font-bold tracking-tight text-[#1d1d1f]">Reconciliation</h1>
        <p className="mt-1 text-[15px] text-[#6e6e73]">Settled claims per SAIC settlement number, rejected claims, claims vs warranty invoicing and the claims you track.</p>
      </header>
      <ReconciliationTabs
        settlementOrders={(orders ?? []).map((o) => o.settlement_order).filter(isOnOrAfterReconStart)}
        branches={(branches ?? []).map(({ id, name }) => ({ id, name }))}
        currency={currency}
        initialView={VIEWS.includes(view as ReconciliationView) ? (view as ReconciliationView) : "settlement"}
      />
    </div>
  );
}
