"use client";

import { use, useMemo, useState } from "react";
import type { PriorApprovals } from "@/lib/dashboard/prior-approvals";
import { C, Donut, LineChart, monthShort } from "@/components/dashboard/charts";
import { Card, Label, Metric, Panel, Pill, fmtInt, fmtNum } from "@/components/dashboard/ui";
import { useHoverCard, TipCard } from "@/components/dashboard/hover";

const chip = "rounded-full px-3 py-1 text-xs font-semibold ring-1 transition";
const selectClass =
  "rounded-lg border-0 bg-[#f5f5f7] px-2.5 py-1.5 text-xs font-semibold text-[#1d1d1f] ring-1 ring-[#e5e5ea] focus:ring-2 focus:ring-[#c4121a]/30 focus:outline-none";

const MAX_STATUSES = 8;
/** MG red for the biggest slice, then silver and graphite - every slice stays visible on both the light and the dark theme. */
const STATUS_COLORS = ["#c4121a", "#8a8d91", "#7a0010", "#e2747b", "#55585c", "#b9bcc0", "#d97706", "#0f766e"];

/** Warranty Prior Approvals: cases per branch, cases over time and the status split, from the company's live Google Sheet. */
export function PriorApprovalsSection({ prior, isOfficer, notice }: { prior: Promise<PriorApprovals>; isOfficer: boolean; notice?: string }) {
  const data = use(prior);

  if (data.status === "not_connected") {
    return (
      <Panel eyebrow="Prior approvals" title="Connect the Prior Approvals sheet" subtitle="These tables read the company's live Google Sheet, read-only.">
        <div className="space-y-3 text-sm text-neutral-700">
          <p>An officer who can open the sheet connects their Google account once. The portal then only reads the sheet - it never changes it.</p>
          {notice && <p className="rounded-lg bg-[#d70015]/10 px-3 py-2 text-[#b10012]">{notice}</p>}
          {isOfficer ? (
            <a href="/api/google-sheets/connect" className="inline-flex rounded-lg bg-[#c4121a] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#a30f16]">
              Connect Google Sheets
            </a>
          ) : (
            <p className="text-[#6e6e73]">Ask an officer to connect it.</p>
          )}
        </div>
      </Panel>
    );
  }
  if (data.status === "error") {
    return (
      <Panel eyebrow="Prior approvals" title="The sheet could not be read">
        <div className="space-y-3 text-sm text-neutral-700">
          <p className="rounded-lg bg-[#d70015]/10 px-3 py-2 text-[#b10012]">{data.message}</p>
          {isOfficer && (
            <a href="/api/google-sheets/connect" className="inline-flex rounded-lg bg-[#f5f5f7] px-4 py-2 text-sm font-semibold text-[#1d1d1f] ring-1 ring-[#e5e5ea] hover:bg-white">
              Reconnect Google Sheets
            </a>
          )}
        </div>
      </Panel>
    );
  }
  return <PriorApprovalsView data={data} />;
}

type Ok = Extract<PriorApprovals, { status: "ok" }>;

function PriorApprovalsView({ data }: { data: Ok }) {
  const [picked, setPicked] = useState<Set<string>>(new Set()); // Co codes ("" = no code); empty = every branch
  const [from, setFrom] = useState(data.months[0] ?? "");
  const [to, setTo] = useState(data.months[data.months.length - 1] ?? "");
  const labelOf = useMemo(() => new Map(data.branches.map((b) => [b.co ?? "", b.label])), [data.branches]);

  const rows = useMemo(() => data.cube.filter((r) => r.m >= from && r.m <= to && (picked.size === 0 || picked.has(r.co ?? ""))), [data.cube, from, to, picked]);
  const total = rows.reduce((s, r) => s + r.n, 0);

  const perBranch = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.co ?? "", (m.get(r.co ?? "") ?? 0) + r.n);
    return [...m.entries()].map(([co, n]) => ({ co, label: labelOf.get(co) ?? co, n })).sort((a, b) => b.n - a.n);
  }, [rows, labelOf]);

  const perMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const mo of data.months) if (mo >= from && mo <= to) m.set(mo, 0);
    for (const r of rows) m.set(r.m, (m.get(r.m) ?? 0) + r.n);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, value]) => ({ month, value }));
  }, [rows, data.months, from, to]);

  const perStatus = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.s, (m.get(r.s) ?? 0) + r.n);
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, MAX_STATUSES);
    const rest = sorted.slice(MAX_STATUSES).reduce((s, x) => s + x[1], 0);
    return [...top, ...(rest > 0 ? ([["Others", rest]] as [string, number][]) : [])].map(([label, value], i) => ({
      label,
      value,
      color: label === "Others" ? C.slateSoft : STATUS_COLORS[i % STATUS_COLORS.length],
    }));
  }, [rows]);

  const yMax = Math.max(...perMonth.map((p) => p.value), 1);
  const niceMax = Math.ceil(yMax / 50) * 50 || 50;
  const topBranch = perBranch[0];
  const topStatus = perStatus[0];
  const toggle = (co: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(co)) n.delete(co);
      else n.add(co);
      return n;
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.05]">
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
        <div className="min-w-0 flex-1 space-y-1">
          <Label>Branch (company code)</Label>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setPicked(new Set())}
              className={`${chip} ${picked.size === 0 ? "bg-[#1d1d1f] text-white ring-[#1d1d1f]" : "bg-white text-neutral-700 ring-[#e5e5ea] hover:bg-[#f5f5f7]"}`}
            >
              All
            </button>
            {data.branches.map((b) => {
              const on = picked.has(b.co ?? "");
              return (
                <button
                  key={b.co ?? "none"}
                  type="button"
                  onClick={() => toggle(b.co ?? "")}
                  className={`${chip} ${on ? "bg-[#1d1d1f] text-white ring-[#1d1d1f]" : "bg-white text-neutral-700 ring-[#e5e5ea] hover:bg-[#f5f5f7]"}`}
                >
                  {b.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="space-y-1">
          <Label>Cases</Label>
          <Metric value={fmtInt(total)} />
          <div className="text-xs text-[#6e6e73]">
            {monthShort(from)} – {monthShort(to)}
          </div>
        </Card>
        <Card className="space-y-1">
          <Label>Busiest branch</Label>
          <Metric value={topBranch ? fmtInt(topBranch.n) : "—"} unit="cases" />
          <div className="truncate text-xs text-[#6e6e73]">{topBranch?.label ?? "—"}</div>
        </Card>
        <Card className="space-y-1">
          <Label>Monthly average</Label>
          <Metric value={fmtNum(perMonth.length ? total / perMonth.length : 0, 0)} unit="cases / month" />
          <div className="text-xs text-[#6e6e73]">{perMonth.length} month{perMonth.length === 1 ? "" : "s"}</div>
        </Card>
        <Card className="space-y-1">
          <Label>Most common status</Label>
          <Metric value={topStatus && total ? `${Math.round((topStatus.value / total) * 100)}%` : "—"} />
          <div className="truncate text-xs text-[#6e6e73]">{topStatus?.label ?? "—"}</div>
        </Card>
      </div>

      <Panel title="Number of cases per branch" subtitle="Prior-approval cases by company code" action={<Pill tone="muted">{perBranch.length} branches</Pill>}>
        <BranchColumns items={perBranch} />
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Panel className="lg:col-span-7" title="Number of cases over time" subtitle="Cases submitted per month">
          <LineChart series={[{ name: "Cases", color: C.accent, points: perMonth }]} yMax={niceMax} unit="" decimals={0} emptyText="No cases in this period." />
        </Panel>
        <Panel className="lg:col-span-5" title="Statuses" subtitle="Where the cases stand">
          {perStatus.length === 0 ? (
            <p className="py-12 text-center text-sm text-neutral-500">No cases in this period.</p>
          ) : (
            <div className="space-y-4">
              <Donut segments={perStatus} center={fmtInt(total)} caption="cases" />
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

      <p className="px-1 text-[11px] text-[#6e6e73]">
        Live from the Warranty Prior Approvals Google Sheet (refreshed every couple of minutes){data.undated > 0 ? ` · ${fmtInt(data.undated)} case(s) without a usable submission date are not charted` : ""}.
      </p>
    </div>
  );
}

/** One column per branch, tallest first - the sheet's "Number of cases per branch" chart. */
function BranchColumns({ items }: { items: { co: string; label: string; n: number }[] }) {
  const { bind, layer } = useHoverCard();
  if (items.length === 0) return <p className="py-12 text-center text-sm text-neutral-500">No cases in this period.</p>;
  const max = Math.max(...items.map((i) => i.n), 1);
  const sum = items.reduce((s, i) => s + i.n, 0) || 1;
  return (
    <div className="flex h-56 items-end gap-2 overflow-x-auto pb-1">
      {layer}
      {items.map((i, idx) => (
        <div
          key={i.co || "none"}
          className="flex h-full min-w-14 flex-1 cursor-default flex-col items-center justify-end gap-1 rounded-t-md transition-colors hover:bg-[#f5f5f7]"
          {...bind(
            <TipCard
              title={i.label}
              rows={[
                { label: "Cases", value: fmtInt(i.n), strong: true },
                { label: "Share", value: `${((i.n / sum) * 100).toFixed(1)}%` },
                ...(i.co ? [{ label: "Company code", value: i.co }] : []),
              ]}
            />
          )}
        >
          <span className="text-[11px] font-semibold tabular-nums text-neutral-700">{fmtInt(i.n)}</span>
          <div className="w-full max-w-14 rounded-t-md" style={{ height: `${Math.max((i.n / max) * 100, 1.5)}%`, background: idx === 0 ? `linear-gradient(to top, ${C.accent}, #e2747b)` : `linear-gradient(to top, #55585c, #8a8d91)` }} />
          <span className="w-full truncate text-center text-[11px] text-neutral-500">{i.label}</span>
        </div>
      ))}
    </div>
  );
}

export function PriorApprovalsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-24 animate-pulse rounded-2xl bg-white ring-1 ring-black/[0.05]" />
      <div className="h-64 animate-pulse rounded-2xl bg-white ring-1 ring-black/[0.05]" />
      <div className="h-64 animate-pulse rounded-2xl bg-white ring-1 ring-black/[0.05]" />
    </div>
  );
}
