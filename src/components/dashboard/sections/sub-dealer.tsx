"use client";

import { useMemo, useState } from "react";
import type { SdBatch, SubDealerDashboard } from "@/lib/dashboard/sub-dealer";
import { SAR_PER_USD } from "@/lib/dashboard/sub-dealer-rate";
import { BarList, C, Donut, LineChart, Meter, StackedBar, monthShort } from "@/components/dashboard/charts";
import { Card, Label, Metric, Panel, Pill, fmtDate, fmtInt, fmtNum } from "@/components/dashboard/ui";

const chip = "rounded-full px-3 py-1 text-xs font-semibold ring-1 transition";
const selectClass =
  "rounded-lg border-0 bg-[#f5f5f7] px-2.5 py-1.5 text-xs font-semibold text-[#1d1d1f] ring-1 ring-[#e5e5ea] focus:ring-2 focus:ring-[#c4121a]/30 focus:outline-none";
/** MG red for the biggest slice, then silver and graphite - every slice stays visible on both the light and the dark theme. */
const STATUS_COLORS = ["#c4121a", "#8a8d91", "#7a0010", "#e2747b", "#55585c", "#b9bcc0", "#d97706", "#0f766e"];

const pretty = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const isClosed = (s: string) => s.trim().toLowerCase() === "closed";
/** A claim that is over for good - closed, rejected or cancelled - is never "open". */
const isRejected = (s: string) => /^(rejected|cancel+ed)$/i.test(s.trim());
const isOpen = (s: string) => !isClosed(s) && !isRejected(s);
const NO_WIP = "No work order";

/** The claim's journey from A to Z; each step is timed from the one before it. */
const STAGES = [
  { key: "dealerReceived", label: "Sub-dealer to dealer", detail: "Claim opened until the dealer approved or rejected it" },
  { key: "partsReplied", label: "Dealer to parts reply", detail: "Dealer read it until parts replied" },
  { key: "partsArrived", label: "Parts reply to parts arrival", detail: "Parts replied until the parts arrived" },
  { key: "repairDone", label: "Parts arrival to after repair", detail: "Parts arrived until the repair was completed" },
  { key: "closed", label: "After repair to closed", detail: "Repair completed until the claim closed" },
] as const;
const DAY_MS = 86_400_000;
const fmtDur = (days: number) => (days < 1 / 24 ? `${Math.max(1, Math.round(days * 1440))} min` : days < 1 ? `${Math.round(days * 24)} h` : `${days.toFixed(1)} days`);
const median = (v: number[]) => {
  const a = [...v].sort((x, y) => x - y);
  return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : 0;
};
const money = (v: number) => fmtNum(v, 2);
const niceCeil = (v: number) => {
  if (v <= 0) return 10;
  const mag = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / mag) * mag;
};
const statusTone = (s: string): "good" | "warn" | "blue" | "muted" => (isClosed(s) ? "good" : /await|wait|pending/i.test(s) ? "warn" : /arriv|progress|submitted/i.test(s) ? "blue" : "muted");

type Group = {
  key: string;
  workOrder: string;
  subWorkOrders: string[];
  statuses: string[];
  vin: string;
  created: string | null;
  approved: number | null;
  batch: SdBatch | null;
};

/** `managerView`: the manager (view only) does not get the work-order-by-work-order table nor the Google connect button. */
export function SubDealerSection({ data, managerView = false }: { data: SubDealerDashboard; managerView?: boolean }) {
  if (data.status === "not_connected") {
    return (
      <Panel eyebrow="Sub-Dealer" title="Connect Google Sheets" subtitle="This dashboard reads the sub-dealer's live Google Sheet, read-only.">
        <div className="space-y-3 text-sm text-neutral-700">
          <p>An officer connects their Google account once (the same connection the Warranty tab uses). The portal then only reads the sheet.</p>
          {!managerView && (
            <a href="/api/google-sheets/connect" className="inline-flex rounded-lg bg-[#c4121a] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#a30f16]">
              Connect Google Sheets
            </a>
          )}
        </div>
      </Panel>
    );
  }
  if (data.status === "error") {
    return (
      <Panel eyebrow="Sub-Dealer" title="The sheet could not be read">
        <p className="rounded-lg bg-[#d70015]/10 px-3 py-2 text-sm text-[#b10012]">{data.message}</p>
      </Panel>
    );
  }
  return <SubDealerView data={data} managerView={managerView} />;
}

type Ok = Extract<SubDealerDashboard, { status: "ok" }>;

function SubDealerView({ data, managerView }: { data: Ok; managerView: boolean }) {
  const [picked, setPicked] = useState<Set<string>>(new Set()); // sub-dealers; empty = all
  const firstMonth = data.months[0] ?? "";
  const lastMonth = data.months[data.months.length - 1] ?? "";
  const [from, setFrom] = useState(firstMonth);
  const [to, setTo] = useState(lastMonth);
  const [showAll, setShowAll] = useState(false);
  const [view, setView] = useState<"revenue" | "lead">("revenue");

  const inScope = (branch: string, month: string | null) => (picked.size === 0 || picked.has(branch)) && (month === null ? from <= firstMonth && to >= lastMonth : month >= from && month <= to);
  const claims = useMemo(() => data.claims.filter((c) => inScope(c.branch, c.month)), [data.claims, picked, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  const free = useMemo(() => data.free.filter((c) => inScope(c.branch, c.month)), [data.free, picked, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  // One row per work order + VIN: its sub-dealer claims on one side, what the dealer's batch holds for it on the other.
  const groups = useMemo(() => {
    const m = new Map<string, Group>();
    for (const c of claims) {
      const key = c.key ?? `claim:${c.id}`;
      const g =
        m.get(key) ??
        ({ key, workOrder: c.workOrder, subWorkOrders: [], statuses: [], vin: c.vin, created: c.created, approved: null, batch: c.key ? (data.batch[c.key] ?? null) : null } as Group);
      if (c.subWorkOrder && !g.subWorkOrders.includes(c.subWorkOrder)) g.subWorkOrders.push(c.subWorkOrder);
      if (!g.statuses.includes(c.status)) g.statuses.push(c.status);
      if (c.created && (!g.created || c.created > g.created)) g.created = c.created;
      if (c.laborApproved != null) g.approved = (g.approved ?? 0) + c.laborApproved;
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""));
  }, [claims, data.batch]);

  const total = claims.length;
  const closed = claims.filter((c) => isClosed(c.status)).length;
  const rejected = claims.filter((c) => isRejected(c.status)).length;
  const open = total - closed - rejected;
  const approvedTotal = claims.reduce((s, c) => s + (c.laborApproved ?? 0), 0);
  const onBatch = groups.filter((g) => g.batch);
  // Rejected claims have no work order and never reach the batch: only real work orders count as "not on the batch yet".
  const notOnBatch = groups.filter((g) => !g.batch && g.workOrder);
  const adjusted = onBatch.reduce((s, g) => s + (g.batch?.adjusted ?? 0), 0);
  const adjustedUsd = onBatch.reduce((s, g) => s + (g.batch?.adjustedUsd ?? 0), 0);
  const settled = onBatch.reduce((s, g) => s + (g.batch?.settled ?? 0), 0);
  const approvedOnBatch = onBatch.reduce((s, g) => s + (g.approved ?? 0), 0);
  const leftWithDealer = adjusted - approvedOnBatch;
  const approvedNotOnBatch = notOnBatch.reduce((s, g) => s + (g.approved ?? 0), 0);
  const freeApproved = free.reduce((s, f) => s + (f.approved ?? 0), 0);
  // Free service: what was invoiced to I660 on the work order minus what was invoiced to I1855 (paid to the sub-dealer).
  const freeInvoiced = free.filter((f) => f.invoiced != null);
  const freeInvoicedTotal = freeInvoiced.reduce((s, f) => s + (f.invoiced ?? 0), 0);
  const freePaidTotal = freeInvoiced.reduce((s, f) => s + (f.paid ?? 0), 0);
  const freeSettled = freeInvoicedTotal - freePaidTotal;
  const freeNotInvoiced = free.length - freeInvoiced.length;

  const today = new Date().toISOString().slice(0, 10);
  const oldestOpen = claims
    .filter((c) => isOpen(c.status) && c.created)
    .reduce<{ workOrder: string; days: number } | null>((best, c) => {
      const days = Math.max(0, Math.round((Date.parse(today) - Date.parse(c.created!)) / 86_400_000));
      return !best || days > best.days ? { workOrder: c.workOrder || NO_WIP, days } : best;
    }, null);

  const monthsInRange = data.months.filter((m) => m >= from && m <= to);
  const perMonth = monthsInRange.map((month) => ({ month, value: claims.filter((c) => c.month === month).length }));
  const perMonthApproved = monthsInRange.map((month) => ({ month, value: Math.round(claims.filter((c) => c.month === month).reduce((s, c) => s + (c.laborApproved ?? 0), 0) * 100) / 100 }));

  const perStatus = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of claims) m.set(c.status, (m.get(c.status) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label: pretty(label), value, color: STATUS_COLORS[i % STATUS_COLORS.length] }));
  }, [claims]);

  // Defective parts are due back once the repair is finished: counted on closed claims only (open claims are not due yet,
  // rejected ones never had a part supplied).
  const closedClaims = claims.filter((c) => isClosed(c.status));
  const partsGot = closedClaims.reduce((s, c) => s + c.partsGot, 0);
  const partsTotal = closedClaims.reduce((s, c) => s + c.partsTotal, 0);
  const partsPct = partsTotal ? (partsGot / partsTotal) * 100 : 0;
  const partsToReturn = closedClaims.filter((c) => c.partsGot < c.partsTotal).map((c) => ({ workOrder: c.workOrder || NO_WIP, left: c.partsTotal - c.partsGot }));
  const partsOnOpen = claims.filter((c) => isOpen(c.status)).reduce((s, c) => s + c.partsTotal, 0);

  // Lead times: every step from the one before it (a claim counts in a step only when both times are known). Rejected claims are
  // left out: their decision can be logged long after it was made (clean-ups), which would distort the averages.
  const leadClaims = claims.filter((c) => !isRejected(c.status));
  const leadStages = STAGES.map((st, i) => {
    const days: number[] = [];
    for (const c of leadClaims) {
      const from = i === 0 ? c.createdAt : c.stages[STAGES[i - 1].key];
      const to = c.stages[st.key];
      if (from != null && to != null && to >= from) days.push((to - from) / DAY_MS);
    }
    return { ...st, n: days.length, avg: days.length ? days.reduce((a, b) => a + b, 0) / days.length : null, med: days.length ? median(days) : null, max: days.length ? Math.max(...days) : null };
  });
  const totalDays = leadClaims.flatMap((c) => (c.createdAt != null && c.stages.closed != null && c.stages.closed >= c.createdAt ? [(c.stages.closed - c.createdAt) / DAY_MS] : []));
  const totalAvg = totalDays.length ? totalDays.reduce((a, b) => a + b, 0) / totalDays.length : null;
  const leadSegments = leadStages.filter((l) => l.avg != null && l.avg > 0).map((l, i) => ({ label: l.label, value: Math.round((l.avg ?? 0) * 1000) / 1000, color: STATUS_COLORS[i % STATUS_COLORS.length] }));
  const topParts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of claims) for (const p of c.parts) m.set(p.name, (m.get(p.name) ?? 0) + p.qty);
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, value]) => ({ label, value, display: `${fmtInt(value)} pcs` }));
  }, [claims]);

  const toggle = (b: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(b)) n.delete(b);
      else n.add(b);
      return n;
    });
  const shown = showAll ? groups : groups.slice(0, 15);

  return (
    <div className="space-y-5">
      {/* The menu bar of this page: revenue and lead times are separate views. */}
      <nav aria-label="Sub-Dealer Analytics sections" className="flex gap-0.5 overflow-x-auto rounded-[14px] bg-[#e9e9ec]/85 p-[3px]">
        {(
          [
            ["revenue", "Revenue"],
            ["lead", "Lead times"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            aria-current={view === id ? "page" : undefined}
            className={`flex min-h-9 flex-1 shrink-0 items-center justify-center rounded-[11px] px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-all ${
              view === id ? "bg-white text-[#1d1d1f] shadow-[0_1px_3px_rgba(0,0,0,0.12),0_1px_1px_rgba(0,0,0,0.04)]" : "text-neutral-700 hover:bg-white/50"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Which sub-dealer, and which months */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.05]">
        <div className="min-w-0 flex-1 space-y-1">
          <Label>Sub-dealer</Label>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setPicked(new Set())} className={`${chip} ${picked.size === 0 ? "bg-[#1d1d1f] text-white ring-[#1d1d1f]" : "bg-white text-neutral-700 ring-[#e5e5ea] hover:bg-[#f5f5f7]"}`}>
              All sub-dealers
            </button>
            {data.branches.map((b) => (
              <button key={b} type="button" onClick={() => toggle(b)} className={`${chip} ${picked.has(b) ? "bg-[#1d1d1f] text-white ring-[#1d1d1f]" : "bg-white text-neutral-700 ring-[#e5e5ea] hover:bg-[#f5f5f7]"}`}>
                {b}
              </button>
            ))}
          </div>
        </div>
        {data.months.length > 0 && (
          <>
            <div className="space-y-1">
              <Label>From</Label>
              <select value={from} onChange={(e) => setFrom(e.target.value > to ? to : e.target.value)} className={`block ${selectClass}`}>
                {data.months.map((m) => (
                  <option key={m} value={m}>
                    {monthShort(m)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>To</Label>
              <select value={to} onChange={(e) => setTo(e.target.value < from ? from : e.target.value)} className={`block ${selectClass}`}>
                {data.months.map((m) => (
                  <option key={m} value={m}>
                    {monthShort(m)}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {view === "revenue" && (
        <>
      {!data.hasLaborApproved && (
        <p className="rounded-xl bg-[#c93400]/10 px-4 py-3 text-sm text-[#a52a00]">
          The sub-dealer sheet has no <strong>Labor Approved (SAR, VAT incl.)</strong> column, so what was settled with the sub-dealer and the dealer&apos;s revenue cannot be shown. It fills in as soon as the column is on the Claims tab.
        </p>
      )}

      {/* The money */}
      <Panel eyebrow="Money" title="Sub-Dealer Warranty Revenue" subtitle="For the work orders the sub-dealer did for the dealer, matched on work order number and VIN">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="space-y-1">
            <Label>Paid to the dealer on the batch</Label>
            <Metric value={money(adjusted)} unit="SAR" />
            <div className="text-xs text-[#6e6e73]">
              Adjusted claim total of {fmtInt(onBatch.length)} work order{onBatch.length === 1 ? "" : "s"}: ${money(adjustedUsd)} USD at {SAR_PER_USD} SAR · settled so far {money(settled)} SAR
            </div>
          </Card>
          <Card className="space-y-1">
            <Label>Settled with the sub-dealer</Label>
            <Metric value={data.hasLaborApproved ? money(approvedTotal) : "—"} unit="SAR" />
            <div className="text-xs text-[#6e6e73]">
              Labor approved, VAT included, on {fmtInt(total)} claim{total === 1 ? "" : "s"}
              {data.hasLaborApproved ? `: ${money(approvedOnBatch)} on work orders already on the batch + ${money(approvedNotOnBatch)} on work orders not on it yet` : ""}
            </div>
          </Card>
          <Card className="space-y-1">
            <Label>Revenue to the dealer</Label>
            <Metric value={data.hasLaborApproved ? money(leftWithDealer) : "—"} unit="SAR" tone={data.hasLaborApproved && leftWithDealer < 0 ? "red" : "green"} />
            <div className="text-xs text-[#6e6e73]">Paid on the batch minus the {money(approvedOnBatch)} settled with the sub-dealer on the same work orders</div>
          </Card>
        </div>
        {notOnBatch.length > 0 && (
          <p className="mt-3 text-xs text-[#6e6e73]">
            {fmtInt(notOnBatch.length)} work order{notOnBatch.length === 1 ? " is" : "s are"} not on the dealer&apos;s claims batch yet
            {data.hasLaborApproved ? ` (${money(approvedNotOnBatch)} SAR approved to the sub-dealer)` : ""} - they join the batch figures once the dealer&apos;s claim is uploaded.
          </p>
        )}
      </Panel>

      {/* Free service: invoiced to I660 minus what is paid to the sub-dealer (I1855) */}
      <Panel eyebrow="Free service" title="Free service settlement" subtitle="Invoiced to account I660, minus what is paid to the sub-dealer (account I1855), on the same work order - labor (KH9) and parts (MG5) lines of the Warranty Invoicing report">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="space-y-1">
            <Label>Invoiced to I660 (free service)</Label>
            <Metric value={money(freeInvoicedTotal)} unit="SAR" />
            <div className="text-xs text-[#6e6e73]">
              {fmtInt(freeInvoiced.length)} of {fmtInt(free.length)} request{free.length === 1 ? "" : "s"} invoiced
            </div>
          </Card>
          <Card className="space-y-1">
            <Label>Paid to the sub-dealer (I1855)</Label>
            <Metric value={money(freePaidTotal)} unit="SAR" />
            <div className="text-xs text-[#6e6e73]">Invoiced to I1855 on the same work orders</div>
          </Card>
          <Card className="space-y-1">
            <Label>Settled amount (free service)</Label>
            <Metric value={money(freeSettled)} unit="SAR" tone={freeSettled < 0 ? "red" : "green"} />
            <div className="text-xs text-[#6e6e73]">Invoiced to I660 minus paid to the sub-dealer</div>
          </Card>
        </div>
        <p className="mt-3 text-xs text-[#6e6e73]">
          {freeNotInvoiced > 0 ? `${fmtInt(freeNotInvoiced)} request${freeNotInvoiced === 1 ? " is" : "s are"} not invoiced yet and join the totals once invoiced. ` : ""}
          Amounts are SAR from the Warranty Invoicing report{data.invoicingThrough ? ` (invoices up to ${fmtDate(data.invoicingThrough)})` : ""}; a line belongs to a request when its work order and VIN both match.
          {free.some((f) => f.approved != null) ? ` The sub-dealer's own approved amount (sheet): ${money(freeApproved)} SAR.` : ""}
        </p>
      </Panel>

        {data.hasLaborApproved && (
          <Panel title="Labor approved over time" subtitle="Settled with the sub-dealer, per month (SAR, VAT incl.)">
            <LineChart series={[{ name: "Labor approved", color: C.accent, points: perMonthApproved }]} yMax={niceCeil(Math.max(...perMonthApproved.map((p) => p.value), 1))} unit=" SAR" decimals={0} compact emptyText="Nothing approved in this period." />
          </Panel>
        )}

      {/* The detail behind every number (not in the manager view) */}
      {!managerView && (
      <Panel title="Work order by work order" subtitle="Each sub-dealer work order next to the dealer's claim for the same car" action={<Pill tone="muted">{fmtInt(groups.length)} work orders</Pill>}>
        {groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-500">No claims in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-[13px]">
              <thead>
                <tr className="border-b border-[#e5e5ea] text-[11px] font-semibold tracking-wide text-[#6e6e73] uppercase">
                  <th className="py-2 pr-3">Dealer WIP</th>
                  <th className="py-2 pr-3">Sub-dealer WIP</th>
                  <th className="py-2 pr-3">Opened</th>
                  <th className="py-2 pr-3">Sub-dealer status</th>
                  <th className="py-2 pr-3 text-right">Settled with sub-dealer</th>
                  <th className="py-2 pr-3 text-right">Paid on the batch</th>
                  <th className="py-2 pr-3">Batch status</th>
                  <th className="py-2 text-right">Revenue to dealer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f2]">
                {shown.map((g) => (
                  <tr key={g.key} className="align-top">
                    <td className="py-2 pr-3 font-mono font-semibold whitespace-nowrap text-[#1d1d1f]">{g.workOrder || <span className="font-sans font-normal text-[#6e6e73]">{NO_WIP}</span>}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-[#6e6e73]">{g.subWorkOrders.join(", ") || "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-[#6e6e73]">{fmtDate(g.created)}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {g.statuses.map((s) => (
                          <Pill key={s} tone={statusTone(s)}>
                            {pretty(s)}
                          </Pill>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{g.approved != null ? money(g.approved) : "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {g.batch ? (
                        <>
                          {money(g.batch.adjusted)}
                          <div className="text-[11px] text-[#6e6e73]">${money(g.batch.adjustedUsd)}</div>
                        </>
                      ) : (
                        <span className="text-[#6e6e73]">{g.workOrder ? "not on batch" : "—"}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {g.batch ? (
                        <div className="flex flex-wrap gap-1">
                          {g.batch.statuses.map((s) => (
                            <Pill key={s} tone={/settled/i.test(s) ? "good" : "muted"}>
                              {s}
                            </Pill>
                          ))}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 text-right font-semibold tabular-nums">{g.batch && g.approved != null ? money(g.batch.adjusted - g.approved) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {groups.length > 15 && (
              <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-3 text-xs font-semibold text-[#c4121a] hover:underline">
                {showAll ? "Show fewer" : `Show all ${fmtInt(groups.length)}`}
              </button>
            )}
          </div>
        )}
      </Panel>
      )}

        </>
      )}

      {view === "lead" && (
        <>
      {/* Lead time, A to Z */}
      <Panel eyebrow="Lead time" title="Lead time, A to Z" subtitle="How long a sub-dealer claim takes at each step, from the sub-dealer opening it to the dealer closing it (rejected claims are not counted)">
        {!data.hasStageTimes && (
          <p className="mb-4 rounded-xl bg-[#c93400]/10 px-4 py-3 text-sm text-[#a52a00]">
            The sheet has no step times yet. Add these date-and-time columns to the Claims tab and the steps below fill in:{" "}
            <strong>Dealer Received At</strong>, <strong>Parts Replied At</strong>, <strong>Parts Arrived At</strong>, <strong>Repair Completed At</strong>, <strong>Closed At</strong>.
          </p>
        )}
        {data.hasStageTimes && data.dealerStep === "received" && (
          <p className="mb-4 rounded-xl bg-[#c93400]/10 px-4 py-3 text-sm text-[#a52a00]">
            Step 1 is not your approve / reject time yet: the sheet only holds the time the claim was logged as received, which is set automatically about a minute after it is opened. Add a <strong>Dealer Decision At</strong> column (the date and time you approve or reject a claim) to the Claims tab and step 1 uses it.
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {leadStages.map((l, i) => (
            <Card key={l.key} className="space-y-1">
              <Label>
                {i + 1}. {l.label}
              </Label>
              <Metric value={l.avg != null ? fmtDur(l.avg) : "—"} />
              {i === 0 && data.dealerStep === "received" && l.n > 0 && (
                <div className="text-xs text-[#a52a00]">Only the time the system logged the claim as received (set automatically) - not your approve / reject click.</div>
              )}
              <div className="text-xs text-[#6e6e73]">
                {l.n ? `average of ${fmtInt(l.n)} claim${l.n === 1 ? "" : "s"} · median ${fmtDur(l.med ?? 0)} · longest ${fmtDur(l.max ?? 0)}` : l.detail}
              </div>
            </Card>
          ))}
          <Card className="space-y-1">
            <Label>A to Z: opened to closed</Label>
            <Metric value={totalAvg != null ? fmtDur(totalAvg) : "—"} tone={totalAvg != null ? "red" : undefined} />
            <div className="text-xs text-[#6e6e73]">
              {totalDays.length ? `average of ${fmtInt(totalDays.length)} closed claim${totalDays.length === 1 ? "" : "s"} · median ${fmtDur(median(totalDays))}` : "Needs the opened and closed times"}
            </div>
          </Card>
        </div>
        {leadSegments.length > 0 && (
          <div className="mt-5 space-y-2">
            <Label>Where the average time goes</Label>
            <StackedBar segments={leadSegments} format={(v) => fmtDur(v)} />
          </div>
        )}
      </Panel>

      {/* Headline numbers */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="space-y-1">
          <Label>Sub-dealer claims</Label>
          <Metric value={fmtInt(total)} />
          <div className="text-xs text-[#6e6e73]">
            {fmtInt(closed)} closed · {fmtInt(open)} open{rejected ? ` · ${fmtInt(rejected)} rejected` : ""}
          </div>
        </Card>
        <Card className="space-y-1">
          <Label>Closed share</Label>
          <Metric value={total ? `${Math.round((closed / total) * 100)}%` : "—"} />
          <div className="text-xs text-[#6e6e73]">of all claims in this period (rejected ones included)</div>
        </Card>
        <Card className="space-y-1">
          <Label>Oldest open claim</Label>
          <Metric value={oldestOpen ? fmtInt(oldestOpen.days) : "—"} unit={oldestOpen ? "days" : undefined} />
          <div className="truncate text-xs text-[#6e6e73]">{oldestOpen ? `Work order ${oldestOpen.workOrder}` : "No open claims"}</div>
        </Card>
        <Card className="space-y-1">
          <Label>Free service</Label>
          <Metric value={fmtInt(free.length)} unit="requests" />
          <div className="text-xs text-[#6e6e73]">{freeInvoiced.length ? `${money(freeSettled)} SAR settled` : "Nothing invoiced yet"}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Panel className="lg:col-span-7" title="Claims over time" subtitle="Sub-dealer claims opened per month">
          <LineChart series={[{ name: "Claims", color: C.accent, points: perMonth }]} yMax={niceCeil(Math.max(...perMonth.map((p) => p.value), 1))} unit="" decimals={0} emptyText="No claims in this period." />
        </Panel>
        <Panel className="lg:col-span-5" title="Where the claims stand" subtitle="Status in the sub-dealer's system">
          {perStatus.length === 0 ? (
            <p className="py-12 text-center text-sm text-neutral-500">No claims in this period.</p>
          ) : (
            <div className="space-y-4">
              <Donut segments={perStatus} center={fmtInt(total)} caption="claims" />
              <ul className="space-y-1.5">
                {perStatus.map((s) => (
                  <li key={s.label} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                      <span className="truncate text-[#1d1d1f]">{s.label}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-[#6e6e73]">
                      <span className="font-semibold text-[#1d1d1f]">{fmtInt(s.value)}</span> · {total ? ((s.value / total) * 100).toFixed(1) : "0"}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Panel className="lg:col-span-6" title="Defective parts returned" subtitle="Closed claims: parts the sub-dealer has sent back to the dealer">
          {partsTotal === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">No closed claims with parts in this period.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <Metric value={`${Math.round(partsPct)}%`} />
                <span className="text-sm text-[#6e6e73]">
                  {fmtInt(partsGot)} of {fmtInt(partsTotal)} parts returned
                </span>
              </div>
              <Meter pct={partsPct} />
              <p className="text-xs text-[#6e6e73]">
                {partsToReturn.length === 0
                  ? "Every part of the closed claims is back."
                  : `${fmtInt(partsTotal - partsGot)} still to be returned: ${partsToReturn.map((p) => p.workOrder).join(", ")}.`}
                {partsOnOpen > 0 ? ` ${fmtInt(partsOnOpen)} more part${partsOnOpen === 1 ? "" : "s"} on open claims are not due yet.` : ""}
              </p>
            </div>
          )}
        </Panel>
        <Panel className="lg:col-span-6" title="Most replaced parts" subtitle="Parts used on the sub-dealer claims, by quantity">
          <BarList items={topParts} />
        </Panel>
      </div>

        </>
      )}

      <p className="px-1 text-[11px] text-[#6e6e73]">
        Live from the sub-dealer&apos;s Google Sheet (refreshed every couple of minutes). A sub-dealer work order and a dealer claim belong together when the work order number (including its -1, -2 follow-up job cards) and the VIN both match. Batch amounts are the adjusted claim totals, which the batch holds in US dollars: they are converted at the fixed rate of 3.75 SAR = 1 USD. All other amounts are in SAR.
      </p>
    </div>
  );
}

export function SubDealerSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-24 animate-pulse rounded-2xl bg-white ring-1 ring-black/[0.05]" />
      <div className="h-64 animate-pulse rounded-2xl bg-white ring-1 ring-black/[0.05]" />
    </div>
  );
}
