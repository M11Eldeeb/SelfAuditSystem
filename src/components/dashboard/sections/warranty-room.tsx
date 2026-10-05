import { BarList, C, Meter, Ring, StackedBar } from "@/components/dashboard/charts";
import { Card, Label, Metric, Panel, Pill, fmtDays, fmtInt } from "@/components/dashboard/ui";
import type { SectionProps } from "./overview";

const AGING_COLORS = [C.green, C.amber, C.red];
const HOLD_DAYS = 90;

export function WarrantyRoomSection({ data }: SectionProps) {
  const wr = data.warrantyRoom;
  const t = data.totals;
  const nearingEnd = wr.aging[2]?.count ?? 0;
  const evidence = data.pending.map((p) => p.scrapEvidence).filter((e) => e != null);
  const evidenceDone = evidence.filter((e) => e.status !== "not_submitted").length;
  const evidenceApproved = evidence.filter((e) => e.status === "approved").length;
  const cycleLabel = evidence[0]?.cycleLabel;
  const branchRows = [...data.branchRows].sort((a, b) => b.warrantyRoomParts - a.warrantyRoomParts);
  const branchMax = Math.max(...branchRows.map((r) => r.warrantyRoomParts + r.flaggedToScrap), 1);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card accent={C.red} className="flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <Label>Parts in custody</Label>
            <Pill tone="muted">Do not scrap</Pill>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <Metric value={fmtInt(wr.parts)} />
              <div className="text-xs text-[#575e70]">parts on {fmtInt(wr.claims)} claims</div>
            </div>
            <Ring
              pct={wr.parts ? ((wr.parts - nearingEnd) / wr.parts) * 100 : 0}
              size={80}
              center={wr.parts ? `${Math.round(((wr.parts - nearingEnd) / wr.parts) * 100)}%` : "—"}
              caption="< 60 days"
              color={C.red}
            />
          </div>
          <div className="text-[11px] text-[#575e70]">Parts the branch holds and must not scrap until told to.</div>
        </Card>

        <Card accent={C.primary} className="flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <Label>Flagged to scrap</Label>
            <Pill tone="bad">Pending</Pill>
          </div>
          <Metric value={fmtInt(t.flaggedToScrap)} unit="claims" tone="red" />
          <div className="space-y-1">
            <StackedBar
              legend={false}
              height="h-3"
              segments={[
                { label: "Held (do not scrap)", value: wr.parts, color: C.slate },
                { label: "Flagged to scrap", value: t.flaggedToScrap, color: C.red },
              ]}
            />
            <div className="flex justify-between text-[11px] text-[#575e70]">
              <span>Held {fmtInt(wr.parts)}</span>
              <span className="font-bold text-[#9a000d]">To scrap {fmtInt(t.flaggedToScrap)}</span>
            </div>
          </div>
        </Card>

        <Card accent={C.blue} className="flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <Label>Scrap evidence</Label>
            {cycleLabel && <Pill tone="blue">{cycleLabel}</Pill>}
          </div>
          <div className="flex items-baseline gap-2">
            <Metric value={`${evidenceDone}/${evidence.length}`} unit="branches submitted" />
          </div>
          <div className="space-y-1">
            <div className="grid h-2.5 gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(evidence.length, 1)}, 1fr)` }}>
              {evidence.map((e, i) => (
                <div
                  key={i}
                  className="h-full rounded"
                  style={{ backgroundColor: e.status === "approved" ? C.blue : e.status === "submitted" ? C.blueSoft : "#dce9ff" }}
                />
              ))}
            </div>
            <div className="flex justify-between text-[11px] text-[#575e70]">
              <span className="font-semibold text-[#0041b0]">{evidenceApproved} approved</span>
              <span>{evidenceDone - evidenceApproved} awaiting review</span>
              <span>{evidence.length - evidenceDone} missing</span>
            </div>
          </div>
          <div className="text-[11px] text-[#575e70]">Avg submission: {fmtDays(t.avgScrapEvidenceDays)} days after cycle generated</div>
        </Card>

        <Card accent={C.amber} className="flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <Label>Holding period</Label>
            {nearingEnd > 0 && <Pill tone="bad">{fmtInt(nearingEnd)} past 60 days</Pill>}
          </div>
          <Metric value={fmtDays(wr.avgHoldingDays)} unit={`avg days of ${HOLD_DAYS}`} />
          <div className="space-y-1">
            <StackedBar
              legend={false}
              height="h-3"
              segments={wr.aging.map((b, i) => ({ label: b.label, value: b.count, color: AGING_COLORS[i] }))}
            />
            <div className="flex justify-between text-[11px]">
              {wr.aging.map((b, i) => (
                <span key={b.label} className="font-semibold" style={{ color: AGING_COLORS[i] }}>
                  {b.label.replace(" days", "d")}: {fmtInt(b.count)}
                </span>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Panel className="lg:col-span-7" title="Parts by branch" subtitle="Held (do not scrap) vs flagged to scrap" action={<Pill tone="muted">{branchRows.length} branches</Pill>}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {branchRows.map((r) => {
              const total = r.warrantyRoomParts + r.flaggedToScrap;
              return (
                <div key={r.branchId} className="space-y-2 rounded-xl bg-[#eff4ff] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-[#0b1c30]">{r.name}</div>
                      <div className="text-[11px] text-[#575e70]">{fmtInt(r.warrantyRoomParts)} held · {fmtInt(r.flaggedToScrap)} flagged</div>
                    </div>
                    <span className="font-display text-lg font-bold text-[#9a000d]">{fmtInt(r.warrantyRoomParts)}</span>
                  </div>
                  <Meter pct={(total / branchMax) * 100} color={C.slate} />
                  <div className="flex justify-between text-[11px] text-[#575e70]">
                    <span>Held: {fmtInt(r.warrantyRoomParts)}</span>
                    <span className="font-semibold text-[#9a000d]">To scrap: {fmtInt(r.flaggedToScrap)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel className="lg:col-span-5" title="Most held parts" subtitle="Top 10 part names in the warranty room">
          <BarList
            color={C.slate}
            valueLabel="Qty"
            items={wr.topParts.map((p) => ({ label: p.label, sublabel: p.sublabel, value: p.count, display: fmtInt(p.count) }))}
          />
        </Panel>
      </div>

    </div>
  );
}
