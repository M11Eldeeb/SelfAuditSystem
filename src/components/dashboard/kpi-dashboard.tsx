"use client";

import { Suspense, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BranchRow, DashboardData } from "@/lib/dashboard/kpis";
import type { TrendData } from "@/lib/dashboard/trends";
import { C, Meter } from "@/components/dashboard/charts";
import { Icon, Label, Panel, Pill, card, fmtInt, fmtMoney, fmtNum } from "@/components/dashboard/ui";
import { DASHBOARD_TABS, type DashboardTab } from "@/components/dashboard/tabs";
import { OverviewSection } from "@/components/dashboard/sections/overview";
import { CycleTimesSection } from "@/components/dashboard/sections/cycle-times";
import { FinancialsSection } from "@/components/dashboard/sections/financials";
import { WarrantyRoomSection } from "@/components/dashboard/sections/warranty-room";
import { TrendsSection, TrendsSkeleton } from "@/components/dashboard/sections/trends";

const TAB_ICONS: Record<DashboardTab, (p: { size?: number }) => React.ReactNode> = {
  overview: Icon.gauge,
  cycle: Icon.timer,
  financials: Icon.receipt,
  warranty: Icon.box,
  trends: Icon.alert,
};

const inputClass =
  "rounded-lg border-0 bg-[#eff4ff] px-3 py-1.5 text-sm font-medium text-[#0b1c30] ring-1 ring-[#dce9ff] focus:ring-2 focus:ring-[#c4121a]/30 focus:outline-none";

type SortKey = keyof Pick<
  BranchRow,
  | "name"
  | "claimCount"
  | "totalClaimAmount"
  | "detectedAmount"
  | "topBoxPct"
  | "avgDailyClaims"
  | "claimsPerWip"
  | "avgRepairCompletionDays"
  | "avgClaimSubmissionDays"
  | "avgSelfAuditDays"
  | "avgScrapEvidenceDays"
  | "warrantyRoomParts"
>;

const COMPARISON_COLUMNS: { key: SortKey; label: string; fmt: (r: BranchRow) => string }[] = [
  { key: "claimCount", label: "Claims", fmt: (r) => fmtInt(r.claimCount) },
  { key: "totalClaimAmount", label: "Amount", fmt: (r) => fmtMoney(r.totalClaimAmount) },
  { key: "detectedAmount", label: "Detected", fmt: (r) => fmtMoney(r.detectedAmount) },
  { key: "topBoxPct", label: "Top box", fmt: (r) => (r.topBoxPct == null ? "—" : `${r.topBoxPct.toFixed(1)}%`) },
  { key: "avgDailyClaims", label: "Daily", fmt: (r) => fmtNum(r.avgDailyClaims) },
  { key: "claimsPerWip", label: "Per WIP", fmt: (r) => fmtNum(r.claimsPerWip, 2) },
  { key: "avgRepairCompletionDays", label: "Repair d", fmt: (r) => fmtNum(r.avgRepairCompletionDays) },
  { key: "avgClaimSubmissionDays", label: "Submit d", fmt: (r) => fmtNum(r.avgClaimSubmissionDays) },
  { key: "avgSelfAuditDays", label: "Self audit d", fmt: (r) => fmtNum(r.avgSelfAuditDays) },
  { key: "avgScrapEvidenceDays", label: "Scrap ev. d", fmt: (r) => fmtNum(r.avgScrapEvidenceDays) },
  { key: "warrantyRoomParts", label: "WR parts", fmt: (r) => fmtInt(r.warrantyRoomParts) },
];

export function KpiDashboard({
  data,
  tab: initialTab,
  basePath,
  from,
  to,
  isOfficer,
  allBranches,
  selectedBranchIds,
  scopeBranches,
  rangeClamped,
  trends,
}: {
  data: DashboardData;
  tab: DashboardTab;
  basePath: string;
  from: string;
  to: string;
  isOfficer: boolean;
  allBranches: { id: string; name: string }[];
  selectedBranchIds: string[];
  scopeBranches: { id: string; name: string }[];
  rangeClamped: boolean;
  /** Officer only - streamed in after the rest of the page. */
  trends?: Promise<TrendData>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Sections are all rendered from data already on the page, so switching
  // is instant - only the URL is updated (for sharing / reload).
  const [tab, setTab] = useState<DashboardTab>(initialTab);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "claimCount", desc: true });

  const t = data.totals;
  const multiBranch = scopeBranches.length > 1;
  const periodLabel = from === to ? from : `${from} → ${to}`;
  const scopeLabel = multiBranch ? `${scopeBranches.length} branches` : (scopeBranches[0]?.name ?? "No branch");
  const tabs = DASHBOARD_TABS.filter((x) => !x.officerOnly || (isOfficer && trends));
  const current = tabs.find((x) => x.id === tab) ?? tabs[0];

  const buildUrl = (next: { tab?: DashboardTab; from?: string; to?: string; branches?: string[] }) => {
    const qs = new URLSearchParams({ tab: next.tab ?? tab, from: next.from ?? from, to: next.to ?? to });
    for (const b of next.branches ?? selectedBranchIds) qs.append("branch", b);
    return `${basePath}?${qs.toString()}`;
  };

  const navigate = (next: { from?: string; to?: string; branches?: string[] }) => {
    startTransition(() => router.push(buildUrl(next), { scroll: false }));
  };

  const switchTab = (id: DashboardTab) => {
    setTab(id);
    window.history.replaceState(null, "", buildUrl({ tab: id }));
  };

  const toggleBranch = (id: string) => {
    const set = new Set(selectedBranchIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    navigate({ branches: [...set] });
  };

  const sortedRows = useMemo(() => {
    const rows = [...data.branchRows];
    rows.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv)) * (sort.desc ? -1 : 1);
      return ((av ?? -Infinity) - (bv ?? -Infinity)) * (sort.desc ? -1 : 1);
    });
    return rows;
  }, [data.branchRows, sort]);

  const sectionProps = { data, scopeBranches, isOfficer };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/* Loading bar while a filter change is fetching */}
      <div className={`fixed inset-x-0 top-0 z-50 h-1 overflow-hidden transition-opacity ${isPending ? "opacity-100" : "opacity-0"}`}>
        <div className="h-full w-1/3 animate-[dash-load_1s_ease-in-out_infinite] bg-[#c4121a]" />
      </div>

      {/* Section navigation */}
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className={`${card} overflow-hidden`}>
          <div className="flex items-center gap-2.5 bg-[#eff4ff] px-4 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#9a000d] font-display text-sm font-bold text-white">MG</span>
            <div className="leading-tight">
              <div className="font-display text-sm font-bold tracking-tight text-[#0b1c30] uppercase">KPI Dashboard</div>
              <div className="text-[10px] font-bold tracking-wider text-[#9a000d] uppercase">Warranty operations</div>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto p-2 lg:flex-col">
            {tabs.map((x) => {
              const active = x.id === tab;
              const TabIcon = TAB_ICONS[x.id];
              return (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => switchTab(x.id)}
                  aria-current={active ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-semibold whitespace-nowrap transition-colors ${
                    active ? "bg-[#c4121a] text-white shadow-sm" : "text-[#575e70] hover:bg-[#eff4ff] hover:text-[#0b1c30]"
                  }`}
                >
                  <TabIcon size={18} />
                  {x.label}
                </button>
              );
            })}
          </nav>
          <div className="hidden space-y-2 border-t border-[#e5eeff] bg-[#f8f9ff] p-3 lg:block">
            <div className="rounded-lg bg-white p-2.5 ring-1 ring-[#dce9ff]/60">
              <div className="flex items-center justify-between">
                <Label>Top box</Label>
                <span className="text-xs font-bold text-[#9a000d]">{t.topBoxPct == null ? "—" : `${t.topBoxPct.toFixed(1)}%`}</span>
              </div>
              <div className="mt-1.5">
                <Meter pct={t.topBoxPct ?? 0} color={C.red} />
              </div>
            </div>
            <div className="flex items-center justify-between px-1 text-[11px] text-[#575e70]">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Work week: Sat – Thu
              </span>
              <span className="flex items-end gap-0.5" title="Sat–Wed full days, Thursday half day">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span key={i} className="h-2.5 w-1.5 rounded-sm bg-[#9a000d]" />
                ))}
                <span className="h-1.5 w-1.5 rounded-sm bg-[#9a000d]/40" />
              </span>
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0 space-y-5">
        {/* Header strip + filters */}
        <div className={`${card} relative overflow-hidden p-4`}>
          <div className="pointer-events-none absolute -right-10 -bottom-12 h-56 w-56 rounded-full bg-[#9a000d]/5" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl font-semibold tracking-tight text-[#0b1c30]">{current.title}</h1>
                <Pill tone="bad">{scopeLabel}</Pill>
                {isPending && <Pill tone="muted">Updating…</Pill>}
              </div>
              <p className="text-sm text-[#575e70]">
                Claims with repair end date in <strong className="text-[#0b1c30]">{periodLabel}</strong> · {fmtNum(t.workingDays, 1)} working days
                (Thu = ½ day)
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-[#eff4ff] px-3 py-1.5 text-xs font-semibold text-[#0b1c30]">
              <Icon.check size={16} />
              {fmtInt(t.claimCount)} claims · {fmtMoney(t.totalClaimAmount)} {data.currency}
            </div>
          </div>

          <div className="relative mt-4 space-y-3 border-t border-[#e5eeff] pt-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1">
                <Label>Repair end from</Label>
                <input
                  key={`from-${from}`}
                  type="month"
                  defaultValue={from}
                  max={to}
                  onChange={(e) => e.target.value && navigate({ from: e.target.value })}
                  className={`block ${inputClass}`}
                />
              </label>
              <label className="space-y-1">
                <Label>Repair end to</Label>
                <input
                  key={`to-${to}`}
                  type="month"
                  defaultValue={to}
                  min={from}
                  onChange={(e) => e.target.value && navigate({ to: e.target.value })}
                  className={`block ${inputClass}`}
                />
              </label>
              <div className="flex flex-wrap gap-1 rounded-lg bg-[#eff4ff] p-0.5">
                {[
                  { label: "Last month", months: 1 },
                  { label: "3 months", months: 3 },
                  { label: "6 months", months: 6 },
                ].map((p) => {
                  const now = new Date();
                  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
                  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (p.months - 1), 1));
                  const f = start.toISOString().slice(0, 7);
                  const tt = end.toISOString().slice(0, 7);
                  const active = f === from && tt === to;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => navigate({ from: f, to: tt })}
                      className={`rounded-md px-3 py-1 text-xs font-bold transition ${
                        active ? "bg-white text-[#0b1c30] shadow-sm" : "text-[#575e70] hover:text-[#0b1c30]"
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              {rangeClamped && <span className="text-xs text-amber-700">Range limited to the 12 months ending at &quot;to&quot;.</span>}
            </div>
            {isOfficer && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Label className="mr-1">Branches</Label>
                <button
                  type="button"
                  onClick={() => navigate({ branches: [] })}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition ${
                    selectedBranchIds.length === 0 ? "bg-[#0b1c30] text-white ring-[#0b1c30]" : "bg-[#eff4ff] text-[#0b1c30] ring-[#dce9ff] hover:bg-[#dce9ff]"
                  }`}
                >
                  All active
                </button>
                {allBranches.map((b) => {
                  const on = selectedBranchIds.includes(b.id);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => toggleBranch(b.id)}
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition ${
                        on ? "bg-[#c4121a] text-white ring-[#c4121a]" : "bg-[#eff4ff] text-[#0b1c30] ring-[#dce9ff] hover:bg-[#dce9ff]"
                      }`}
                    >
                      {b.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className={`space-y-5 transition-opacity duration-200 ${isPending ? "pointer-events-none opacity-50" : ""}`}>
          {tab === "overview" && <OverviewSection {...sectionProps} />}
          {tab === "cycle" && <CycleTimesSection {...sectionProps} />}
          {tab === "financials" && <FinancialsSection {...sectionProps} />}
          {tab === "warranty" && <WarrantyRoomSection {...sectionProps} />}
          {tab === "trends" && trends && (
            <Suspense fallback={<TrendsSkeleton />}>
              <TrendsSection trends={trends} data={data} />
            </Suspense>
          )}

          {multiBranch && tab === "overview" && (
            <Panel
              title="Branch comparison"
              subtitle={`Claims with repair end date in ${periodLabel} · click a column to sort, a branch to drill in`}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead className="bg-[#eff4ff] text-left text-[11px] font-bold tracking-wider text-[#575e70] uppercase">
                    <tr>
                      {[{ key: "name" as SortKey, label: "Branch" }, ...COMPARISON_COLUMNS].map((col) => (
                        <th
                          key={col.key}
                          className={`cursor-pointer px-3 py-2.5 select-none hover:text-[#0b1c30] ${col.key === "name" ? "sticky left-0 bg-[#eff4ff]" : "text-right"}`}
                          onClick={() => setSort((s) => ({ key: col.key, desc: s.key === col.key ? !s.desc : col.key !== "name" }))}
                        >
                          {col.label}
                          {sort.key === col.key && <span className="ml-1 text-[#c4121a]">{sort.desc ? "▼" : "▲"}</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e5eeff] tabular-nums">
                    {sortedRows.map((r) => (
                      <tr key={r.branchId} className="cursor-pointer hover:bg-[#eff4ff]" onClick={() => navigate({ branches: [r.branchId] })}>
                        <td className="sticky left-0 bg-white px-3 py-2 font-semibold text-[#0b1c30]">{r.name} →</td>
                        {COMPARISON_COLUMNS.map((col) => (
                          <td
                            key={col.key}
                            className={`px-3 py-2 text-right ${col.key === "detectedAmount" && r.detectedAmount < 0 ? "font-semibold text-[#9a000d]" : ""} ${
                              sort.key === col.key ? "bg-[#eff4ff]/60 font-semibold" : ""
                            }`}
                          >
                            {col.fmt(r)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
