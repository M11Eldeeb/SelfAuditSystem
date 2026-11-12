"use client";

import { useEffect, useState } from "react";
import { getSubDealerForDashboard } from "@/app/actions/sub-dealer";
import type { SubDealerDashboard } from "@/lib/dashboard/sub-dealer";
import { SubDealerSection } from "@/components/dashboard/sections/sub-dealer";
import { CarLoaderCard } from "@/components/spinner";
import { Panel } from "@/components/dashboard/ui";

/** The manager's Sub-dealer Dashboard tab: the sheet is read when the tab is opened, not with every dashboard load. */
export function SubDealerTab() {
  const [data, setData] = useState<SubDealerDashboard | { status: "denied" } | "failed" | null>(null);
  useEffect(() => {
    let live = true;
    getSubDealerForDashboard()
      .then((d) => live && setData(d))
      .catch(() => live && setData("failed"));
    return () => {
      live = false;
    };
  }, []);

  if (!data) return <CarLoaderCard label="Loading the sub-dealer dashboard…" />;
  if (data === "failed" || data.status === "denied")
    return (
      <Panel title="Sub-dealer Dashboard">
        <p className="rounded-lg bg-[#d70015]/10 px-3 py-2 text-sm text-[#b10012]">{data === "failed" ? "The sub-dealer dashboard could not be loaded. Try again." : "Your branch has no sub-dealer work orders."}</p>
      </Panel>
    );
  return <SubDealerSection data={data} managerView />;
}
