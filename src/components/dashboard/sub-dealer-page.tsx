import { displayFont } from "@/components/dashboard/font";
import { loadSubDealerDashboard } from "@/lib/dashboard/sub-dealer";
import { SubDealerSection } from "@/components/dashboard/sections/sub-dealer";

/** The Sub-Dealer Analytics page (the officer's, the manager's and the Heraa service manager's). */
export async function SubDealerPage({ managerView, viewOnly = managerView, dashboardName = false }: { managerView: boolean; viewOnly?: boolean; dashboardName?: boolean }) {
  const data = await loadSubDealerDashboard();
  return (
    <div className={`${displayFont.variable} relative left-1/2 w-[min(96rem,calc(100vw-var(--sidebar-w,0px)-2rem))] -translate-x-1/2 space-y-5`}>
      <div className="px-1">
        <p className="text-[13px] font-semibold text-[#6e6e73]">Warranty</p>
        <h1 className="text-2xl font-bold tracking-tight text-[#1d1d1f]">{dashboardName ? "Sub-Dealer Dashboard" : "Sub-Dealer Analytics"}</h1>
        <p className="mt-0.5 text-[15px] text-[#6e6e73]">Claims done for the dealer by its sub-dealers: where they stand and the warranty revenue of the dealer and the sub-dealer.</p>
      </div>
      <SubDealerSection data={data} managerView={managerView} viewOnly={viewOnly} />
    </div>
  );
}
