"use client";

import { useMemo, useState } from "react";
import type { SdBatch, SubDealerDashboard } from "@/lib/dashboard/sub-dealer";
import { BarList, C, Donut, LineChart, Meter, monthShort } from "@/components/dashboard/charts";
import { Card, Label, Metric, Panel, Pill, fmtDate, fmtInt, fmtNum } from "@/components/dashboard/ui";

const chip = "rounded-full px-3 py-1 text-xs font-semibold ring-1 transition";
const selectClass =
  "rounded-lg border-0 bg-[#f5f5f7] px-2.5 py-1.5 text-xs font-semibold text-[#1d1d1f] ring-1 ring-[#e5e5ea] focus:ring-2 focus:ring-[#c4121a]/30 focus:outline-none";
/** MG red for the biggest slice, then silver and graphite - every slice stays visible on both the light and the dark theme. */
const STATUS_COLORS = ["#c4121a", "#8a8d91", "#7a0010", "#e2747b", "#55585c", "#b9bcc0", "#d97706", "#0f766e"];

const pretty = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const isClosed = (s: string) => s.trim().toLowerCase() === "closed";
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
  claimIds: string[];
  statuses: string[];
  vin: string;
  created: string | null;
  approved: number | null;
  batch: SdBatch | null;
};

export function SubDealerSection({ data }: { data: SubDealerDashboard }) {
  if (data.status === "not_connected") {
    return (
      <Panel eyebrow="Sub-Dealer" title="Connect Google Sheets" subtitle="This dashboard reads the sub-dealer's live Google Sheet, read-only.">
        <div className="space-y-3 text-sm text-neutral-700">
          <p>An officer connects their Google account once (the same connection the Warranty tab uses). The portal then only reads the sheet.</p>
          <a href="/api/google-sheets/connect" className="inline-flex rounded-lg bg-[#c4121a] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#a30f16]">
            Connect Google Sheets
          </a>
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
  return <SubDealerView data={data} />;
}

type Ok = Extract<SubDealerDashboard, { status: "ok" }>;

function SubDealerView({ data }: { data: Ok }) {
  const [picked, setPicked] = useState<Set<string>>(new Set()); // sub-dealers; empty = all
  const firstMonth = data.months[0] ?? "";
  const lastMonth = data.months[data.months.length - 1] ?? "";
  const [from, setFrom] = useState(firstMonth);
  const [to, setTo] = useState(lastMonth);
  const [showAll, setShowAll] = useState(false);

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
        ({ key, workOrder: c.workOrder, subWorkOrders: [], claimIds: [], statuses: [], vin: c.vin, created: c.created, approved: null, batch: c.key ? (data.batch[c.key] ?? null) : null } as Group);
      g.claimIds.push(c.id);
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
  const open = total - closed;
  const approvedTotal = claims.reduce((s, c) => s + (c.laborApproved ?? 0), 0);
  const onBatch = groups.filter((g) => g.batch);
  const notOnBatch = groups.filter((g) => !g.batch);
  const adjusted = onBatch.reduce((s, g) => s + (g.batch?.adjusted ?? 0), 0);
  const settled = onBatch.reduce((s, g) => s + (g.batch?.settled ?? 0), 0);
  const approvedOnBatch = onBatch.reduce((s, g) => s + (g.approved ?? 0), 0);
  const leftWithDealer = adjusted - approvedOnBatch;
  const approvedNotOnBatch = notOnBatch.reduce((s, g) => s + (g.approved ?? 0), 0);
  const freeApproved = free.reduce((s, f) => s + (f.approved ?? 0), 0);

  const today = new Date().toISOString().slice(0, 10);
  const oldestOpen = claims
    .filter((c) => !isClosed(c.status) && c.created)
    .reduce<{ id: string; days: number } | null>((best, c) => {
      const days = Math.max(0, Math.round((Date.parse(today) - Date.parse(c.created!)) / 86_400_000));
      return !best || days > best.days ? { id: c.id, days } : best;
    }, null);

  const monthsInRange = data.months.filter((m) => m >= from && m <= to);
  const perMonth = monthsInRange.map((month) => ({ month, value: claims.filter((c) => c.month === month).length }));
  const perMonthApproved = monthsInRange.map((month) => ({ month, value: Math.round(claims.filter((c) => c.month === month).reduce((s, c) => s + (c.laborApproved ?? 0), 0) * 100) / 100 }));

  const perStatus = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of claims) m.set(c.status, (m.get(c.status) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label: pretty(label), value, color: STATUS_COLORS[i % STATUS_COLORS.length] }));
  }, [claims]);

  const partsGot = claims.reduce((s, c) => s + c.partsGot, 0);
  const partsTotal = claims.reduce((s, c) => s + c.partsTotal, 0);
  const partsPct = partsTotal ? (partsGot / partsTotal) * 100 : 0;
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

      {!data.hasLaborApproved && (
        <p className="rounded-xl bg-[#c93400]/10 px-4 py-3 text-sm text-[#a52a00]">
          The sub-dealer sheet has no <strong>Labor Approved (SAR, VAT incl.)</strong> column yet, so the money to the sub-dealer and what stays with the dealer cannot be shown. It fills in as soon as the column is added to the Claims tab.
        </p>
      )}

      {/* The money */}
      <Panel eyebrow="Money" title="Who received what" subtitle="For the work orders the sub-dealer did for the dealer, matched on work order number and VIN">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="space-y-1">
            <Label>Paid to the dealer on the batch</Label>
            <Metric value={money(adjusted)} unit="SAR" />
            <div className="text-xs text-[#6e6e73]">
              Adjusted claim total of {fmtInt(onBatch.length)} work order{onBatch.length === 1 ? "" : "s"} · settled so far {money(settled)}
            </div>
          </Card>
          <Card className="space-y-1">
            <Label>Came to the sub-dealer</Label>
            <Metric value={data.hasLaborApproved ? money(approvedTotal) : "—"} unit="SAR" />
            <div className="text-xs text-[#6e6e73]">Labor approved, VAT included, on {fmtInt(total)} claim{total === 1 ? "" : "s"}</div>
          </Card>
          <Card className="space-y-1">
            <Label>Stays with the dealer</Label>
            <Metric value={data.hasLaborApproved ? money(leftWithDealer) : "—"} unit="SAR" tone={data.hasLaborApproved && leftWithDealer < 0 ? "red" : "green"} />
            <div className="text-xs text-[#6e6e73]">Batch total minus the labor approved to the sub-dealer on the same work orders ({money(approvedOnBatch)})</div>
          </Card>
        </div>
        {notOnBatch.length > 0 && (
          <p className="mt-3 text-xs text-[#6e6e73]">
            {fmtInt(notOnBatch.length)} work order{notOnBatch.length === 1 ? " is" : "s are"} not on the dealer&apos;s claims batch yet
            {data.hasLaborApproved ? ` (${money(approvedNotOnBatch)} SAR approved to the sub-dealer)` : ""} - they join the batch figures once the dealer&apos;s claim is uploaded.
          </p>
        )}
      </Panel>

      {/* Headline numbers */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="space-y-1">
          <Label>Sub-dealer claims</Label>
          <Metric value={fmtInt(total)} />
          <div className="text-xs text-[#6e6e73]">
            {fmtInt(closed)} closed · {fmtInt(open)} open
          </div>
        </Card>
        <Card className="space-y-1">
          <Label>Closed share</Label>
          <Metric value={total ? `${Math.round((closed / total) * 100)}%` : "—"} />
          <div className="text-xs text-[#6e6e73]">of all claims in this period</div>
        </Card>
        <Card className="space-y-1">
          <Label>Oldest open claim</Label>
          <Metric value={oldestOpen ? fmtInt(oldestOpen.days) : "—"} unit={oldestOpen ? "days" : undefined} />
          <div className="truncate text-xs text-[#6e6e73]">{oldestOpen?.id ?? "No open claims"}</div>
        </Card>
        <Card className="space-y-1">
          <Label>Free service</Label>
          <Metric value={fmtInt(free.length)} unit="requests" />
          <div className="text-xs text-[#6e6e73]">{free.some((f) => f.approved != null) ? `${money(freeApproved)} SAR approved` : "No amounts yet"}</div>
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
        {data.hasLaborApproved && (
          <Panel className="lg:col-span-7" title="Labor approved over time" subtitle="Came to the sub-dealer, per month (SAR, VAT incl.)">
            <LineChart series={[{ name: "Labor approved", color: C.accent, points: perMonthApproved }]} yMax={niceCeil(Math.max(...perMonthApproved.map((p) => p.value), 1))} unit=" SAR" decimals={0} emptyText="Nothing approved in this period." />
          </Panel>
        )}
        <Panel className={data.hasLaborApproved ? "lg:col-span-5" : "lg:col-span-6"} title="Defective parts returned" subtitle="Parts the sub-dealer has sent back to the dealer">
          {partsTotal === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-500">No parts on these claims.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <Metric value={`${Math.round(partsPct)}%`} />
                <span className="text-sm text-[#6e6e73]">
                  {fmtInt(partsGot)} of {fmtInt(partsTotal)} parts received
                </span>
              </div>
              <Meter pct={partsPct} />
            </div>
          )}
        </Panel>
        <Panel className={data.hasLaborApproved ? "lg:col-span-12" : "lg:col-span-6"} title="Most replaced parts" subtitle="Parts used on the sub-dealer claims, by quantity">
          <BarList items={topParts} />
        </Panel>
      </div>

      {/* The detail behind every number */}
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
                  <th className="py-2 pr-3">Claim</th>
                  <th className="py-2 pr-3">VIN</th>
                  <th className="py-2 pr-3">Sub-dealer status</th>
                  <th className="py-2 pr-3 text-right">Came to sub-dealer</th>
                  <th className="py-2 pr-3 text-right">Dealer batch</th>
                  <th className="py-2 pr-3">Batch status</th>
                  <th className="py-2 text-right">Stays with dealer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f2]">
                {shown.map((g) => (
                  <tr key={g.key} className="align-top">
                    <td className="py-2 pr-3 font-mono font-semibold whitespace-nowrap text-[#1d1d1f]">{g.workOrder}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-[#6e6e73]">{g.subWorkOrders.join(", ") || "—"}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-[#6e6e73]">
                      {g.claimIds.join(", ")}
                      <div className="text-[11px]">{fmtDate(g.created)}</div>
                    </td>
                    <td className="py-2 pr-3 font-mono text-[12px] whitespace-nowrap text-[#6e6e73]">…{g.vin.slice(-6)}</td>
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
                    <td className="py-2 pr-3 text-right tabular-nums">{g.batch ? money(g.batch.adjusted) : <span className="text-[#6e6e73]">not on batch</span>}</td>
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

      <p className="px-1 text-[11px] text-[#6e6e73]">
        Live from the sub-dealer&apos;s Google Sheet (refreshed every couple of minutes). A sub-dealer work order and a dealer claim belong together when the work order number (including its -1, -2 follow-up job cards) and the VIN both match. Batch amounts are the adjusted claim totals; all amounts in SAR.
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
