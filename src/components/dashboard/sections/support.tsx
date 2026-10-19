"use client";

import { use } from "react";
import type { LeadStat, SupportLeadTimes } from "@/lib/dashboard/support";
import { C, Meter } from "@/components/dashboard/charts";
import { TipCard, useHoverCard } from "@/components/dashboard/hover";
import { Card, Label, Metric, Panel, Pill, fmtInt } from "@/components/dashboard/ui";

const fmtHours = (h: number | null) => (h == null ? "—" : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`);

function LeadCard({ title, stat, accent, bind }: { title: string; stat: LeadStat; accent: string; bind: ReturnType<typeof useHoverCard>["bind"] }) {
  return (
    <Card accent={accent} className="flex flex-col gap-3">
      <div
        {...bind(
          <TipCard
            title={title}
            rows={[
              { label: "Submitted in period", value: fmtInt(stat.submitted) },
              { label: "Finished", value: fmtInt(stat.finished) },
              { label: "Still open", value: fmtInt(stat.open) },
              { label: "Average lead time", value: fmtHours(stat.avgHours), strong: true },
              { label: "Median lead time", value: fmtHours(stat.medianHours) },
              { label: "Closed within 24 h", value: stat.within24hPct == null ? "—" : `${stat.within24hPct.toFixed(0)}%` },
              { label: "Oldest still open", value: fmtHours(stat.oldestOpenHours) },
            ]}
            note="Submission until closure"
          />
        )}
      >
        <Label>{title}</Label>
        <Metric value={fmtHours(stat.avgHours)} unit="avg closure" />
        <div className="text-xs text-[#575e70]">median {fmtHours(stat.medianHours)}</div>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-[11px] text-[#575e70]">
          <span>Closed within 24 h</span>
          <span className="font-semibold">{stat.within24hPct == null ? "—" : `${stat.within24hPct.toFixed(0)}%`}</span>
        </div>
        <Meter pct={stat.within24hPct ?? 0} color={accent} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Pill tone="muted">{fmtInt(stat.submitted)} submitted</Pill>
        <Pill tone={stat.open ? "warn" : "good"}>{fmtInt(stat.open)} open</Pill>
        {stat.oldestOpenHours != null && <Pill tone={stat.oldestOpenHours > 48 ? "bad" : "muted"}>oldest {fmtHours(stat.oldestOpenHours)}</Pill>}
      </div>
    </Card>
  );
}

/** Cycle Times & SLA: how long the technical team takes to close Technical Inquiries and Verification Code requests. */
export function SupportLeadTimesPanel({ support }: { support: Promise<SupportLeadTimes> }) {
  const s = use(support);
  const { bind, layer } = useHoverCard();
  return (
    <Panel eyebrow="Technical support" title="Closure lead time" subtitle="Requests submitted in the selected months - from submission until closed (inquiries) or the code is sent / rejected (verification codes)">
      {layer}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <LeadCard title="Technical inquiries" stat={s.inquiries} accent={C.primary} bind={bind} />
        <LeadCard title="Verification codes" stat={s.codes} accent={C.blue} bind={bind} />
      </div>
    </Panel>
  );
}
