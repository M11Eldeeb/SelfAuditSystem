import type { ReactNode } from "react";
import type { DashboardData } from "@/lib/dashboard/kpis";
import { LineChart } from "@/components/dashboard/charts";
import { Panel } from "@/components/dashboard/ui";
import { toSeries } from "./overview";

/** The manager's Audits tab: the podium of each month and the standings (built on the server), then the audit score trends. */
export function AuditsSection({
  data,
  scopeBranches,
  panel,
}: {
  data: DashboardData;
  scopeBranches: { id: string; name: string }[];
  panel?: ReactNode;
}) {
  return (
    <div className="space-y-5">
      {panel}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel eyebrow="Trend" title="Self audit score" subtitle="Monthly score, all finalized cycles">
          <LineChart series={toSeries(data.selfAuditScores, scopeBranches)} emptyText="No finalized self audits yet." />
        </Panel>
        <Panel eyebrow="Trend" title="Internal audit score" subtitle="Monthly score, all finalized audits">
          <LineChart series={toSeries(data.internalAuditScores, scopeBranches)} emptyText="No finalized internal audits yet." />
        </Panel>
      </div>
    </div>
  );
}
