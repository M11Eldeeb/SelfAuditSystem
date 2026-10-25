"use client";

import { Suspense, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BranchRow, DashboardData } from "@/lib/dashboard/kpis";
import type { TrendData } from "@/lib/dashboard/trends";
import { Icon, Label, Panel, Pill, card, fmtInt, fmtMoney, fmtNum } from "@/components/dashboard/ui";
import { DASHBOARD_TABS, type DashboardTab } from "@/components/dashboard/tabs";
import { SupportLeadTimesPanel } from "@/components/dashboard/sections/support";
import { RejectedClaimsPanel } from "@/components/dashboard/sections/rejected-claims";
import type { RejectedEntry } from "@/lib/dashboard/rejected";
import { InvoicingSection } from "@/components/dashboard/sections/invoicing";
import type { SupportLeadTimes } from "@/lib/dashboard/support";
import { OverviewSection } from "@/components/dashboard/sections/overview";
import { CycleTimesSection } from "@/components/dashboard/sections/cycle-times";
import { FinancialsSection } from "@/components/dashboard/sections/financials";
import type { SettlementForecast } from "@/lib/dashboard/forecast";
import { WarrantyRoomSection } from "@/components/dashboard/sections/warranty-room";
import { TrendsSection, TrendsSkeleton } from "@/components/dashboard/sections/trends";
import { SectionErrorBoundary } from "@/components/dashboard/error-boundary";
import { Reveal } from "@/components/dashboard/motion";
import { TaskTracker } from "@/components/tasks/task-list";
import type { TaskData } from "@/lib/tasks";
import { ReconciliationSection } from "@/components/dashboard/sections/reconciliation";
import { RejectedReviewSection } from "@/components/dashboard/sections/rejected-review";

const TAB_ICONS: Record<DashboardTab, (p: { size?: number }) => React.ReactNode> = {
  tasks: Icon.check,
  overview: Icon.gauge,
  cycle: Icon.timer,
  financials: Icon.receipt,
  warranty: Icon.box,
  trends: Icon.alert,
  reconciliation: Icon.money,
};

/** Reconciliation has two tabs: settled claims per settlement number, and SAIC-rejected claims to review within 30 days. */
function ReconciliationTabs(props: { settlementOrders: string[]; branches: { id: string; name: string }[]; currency: string }) {
  const [view, setView] = useState<"settlement" | "rejected">("settlement");
  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-xl bg-[#f5f5f7] p-1 text-sm font-semibold ring-1 ring-black/[0.05]">
        {(
          [
            ["settlement", "Settled claims"],
            ["rejected", "Rejected claims"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setView(k)} className={`flex-1 rounded-lg px-3 py-1.5 ${view === k ? "bg-white text-[#1d1d1f] shadow-sm" : "text-[#6e6e73] hover:text-[#1d1d1f]"}`}>
            {label}
          </button>
        ))}
      </div>
      {view === "settlement" ? <ReconciliationSection {...props} /> : <RejectedReviewSection currency={props.currency} />}
    </div>
  );
}

const inputClass =
  "rounded-xl border-0 bg-[#f5f5f7] px-3 py-1.5 text-sm font-medium text-[#1d1d1f] ring-1 ring-black/[0.06] focus:ring-2 focus:ring-[#c4121a]/30 focus:outline-none";

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
  forecast,
  settlementOrders = [],
  tasks,
  support,
  rejected,
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
  /** Officer only - settlement history + 3-month forecast, streamed in. */
  forecast?: Promise<SettlementForecast>;
  /** Officer only - newest first. */
  settlementOrders?: string[];
  tasks?: TaskData;
  /** Technical Inquiries / Verification Codes closure lead time (Cycle Times tab), streamed in. */
  support?: Promise<SupportLeadTimes>;
  /** Rejected Claims Diary entries (Overview tab), streamed in; absent while the diary is locked for this user. */
  rejected?: Promise<RejectedEntry[]>;
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
  const tabs = DASHBOARD_TABS.filter((x) => !x.officerOnly || isOfficer);
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
    <div className="space-y-5">
      {/* Loading bar while a filter change is fetching */}
      <div className={`fixed inset-x-0 top-0 z-50 h-1 overflow-hidden transition-opacity ${isPending ? "opacity-100" : "opacity-0"}`}>
        <div className="h-full w-1/3 animate-[dash-load_1s_ease-in-out_infinite] bg-[#c4121a]" />
      </div>

      {/* Title: what you are looking at, for which branches and period. */}
      <header className="flex flex-wrap items-end justify-between gap-4 px-1">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[#6e6e73]">KPI Dashboard</p>
          <h1 className="text-[28px] leading-tight font-bold tracking-tight text-[#1d1d1f]">{current.title}</h1>
          {tab === "reconciliation" ? (
            <p className="mt-1 text-[15px] text-[#6e6e73]">Settled claims per SAIC settlement number - choose the settlement and branch below.</p>
          ) : (
            <p className="mt-1 text-[15px] text-[#6e6e73]">
              {scopeLabel} · repair end <span className="font-semibold text-[#1d1d1f]">{periodLabel}</span> · {fmtNum(t.workingDays, 1)} working days (Sat–Thu, Thu = ½)
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isPending && <Pill tone="muted">Updating…</Pill>}
          <span className="rounded-full bg-white px-3 py-1.5 text-[13px] font-semibold text-[#1d1d1f] shadow-sm ring-1 ring-black/[0.05]">
            {fmtInt(t.claimCount)} claims · {fmtMoney(t.totalClaimAmount)} {data.currency}
          </span>
        </div>
      </header>

      {/* Sections: a segmented control that stays on screen while scrolling. */}
      <nav aria-label="Dashboard sections" className="sticky top-[68px] z-10 -mx-1 px-1 py-1">
        <div className="flex gap-0.5 overflow-x-auto rounded-[14px] bg-[#e9e9ec]/85 p-[3px] backdrop-blur-xl backdrop-saturate-150">
          {tabs.map((x) => {
            const active = x.id === tab;
            const TabIcon = TAB_ICONS[x.id];
            return (
              <button
                key={x.id}
                type="button"
                onClick={() => switchTab(x.id)}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-9 flex-1 shrink-0 items-center justify-center gap-2 rounded-[11px] px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-all ${
                  active ? "bg-white text-[#1d1d1f] shadow-[0_1px_3px_rgba(0,0,0,0.12),0_1px_1px_rgba(0,0,0,0.04)]" : "text-[#3a3a3c] hover:bg-white/50"
                }`}
              >
                <TabIcon size={17} />
                {x.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Filters (not for Reconciliation / Tasks, which have their own). */}
      {tab !== "reconciliation" && tab !== "tasks" && (
        <div className={`${card} space-y-3 p-4`}>
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
            <div className="flex flex-wrap gap-1 rounded-xl bg-[#f5f5f7] p-1">
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
                    className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition ${active ? "bg-white text-[#1d1d1f] shadow-sm" : "text-[#6e6e73] hover:text-[#1d1d1f]"}`}
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
                className={`rounded-full px-3 py-1 text-[13px] font-semibold ring-1 transition ${
                  selectedBranchIds.length === 0 ? "bg-[#1d1d1f] text-white ring-[#1d1d1f]" : "bg-white text-[#1d1d1f] ring-black/10 hover:bg-[#f5f5f7]"
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
                    aria-pressed={on}
                    className={`rounded-full px-3 py-1 text-[13px] font-semibold ring-1 transition ${
                      on ? "bg-[#c4121a] text-white ring-[#c4121a]" : "bg-white text-[#1d1d1f] ring-black/10 hover:bg-[#f5f5f7]"
                    }`}
                  >
                    {b.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="min-w-0">
        <Reveal animKey={tab} className={`space-y-5 transition-opacity duration-200 ${isPending ? "pointer-events-none opacity-50" : ""}`}>
          {tab === "tasks" && (tasks ? <TaskTracker data={tasks} isOfficer={isOfficer} /> : null)}
          {tab === "overview" && <OverviewSection {...sectionProps} />}
          {tab === "overview" && rejected && (
            <SectionErrorBoundary onRetry={() => startTransition(() => router.refresh())}>
              <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-white ring-1 ring-[#e5e5e5]" />}>
                <RejectedClaimsPanel rejected={rejected} from={from} to={to} diaryPath={isOfficer ? "/admin/rejected-claims" : "/audit/rejected-claims"} showBranches={isOfficer} />
              </Suspense>
            </SectionErrorBoundary>
          )}
          {tab === "cycle" && <CycleTimesSection {...sectionProps} />}
          {tab === "cycle" && support && (
            <SectionErrorBoundary onRetry={() => startTransition(() => router.refresh())}>
              <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-white ring-1 ring-[#e5e5ea]/60" />}>
                <SupportLeadTimesPanel support={support} />
              </Suspense>
            </SectionErrorBoundary>
          )}
          {tab === "financials" && (
            <FinancialsSection
              {...sectionProps}
              forecast={isOfficer ? forecast : undefined}
              onOpenReconciliation={isOfficer ? () => switchTab("reconciliation") : undefined}
            />
          )}
          {tab === "financials" && isOfficer && (
            <div className="space-y-5 border-t-2 border-dashed border-[#e5e5e5] pt-5">
              <InvoicingSection />
            </div>
          )}
          {tab === "warranty" && <WarrantyRoomSection {...sectionProps} />}
          {tab === "trends" && trends && (
            <SectionErrorBoundary onRetry={() => startTransition(() => router.refresh())}>
              <Suspense fallback={<TrendsSkeleton />}>
                <TrendsSection trends={trends} data={data} />
              </Suspense>
            </SectionErrorBoundary>
          )}
          {tab === "reconciliation" && isOfficer && <ReconciliationTabs settlementOrders={settlementOrders} branches={allBranches} currency={data.currency} />}

          {multiBranch && tab === "overview" && (
            <Panel
              title="Branch comparison"
              subtitle={`Claims with repair end date in ${periodLabel} · click a column to sort, a branch to drill in`}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead className="bg-[#f5f5f7] text-left text-[11px] font-bold tracking-wider text-[#6e6e73] uppercase">
                    <tr>
                      {[{ key: "name" as SortKey, label: "Branch" }, ...COMPARISON_COLUMNS].map((col) => (
                        <th
                          key={col.key}
                          className={`cursor-pointer px-3 py-2.5 select-none hover:text-[#1d1d1f] ${col.key === "name" ? "sticky left-0 bg-[#f5f5f7]" : "text-right"}`}
                          onClick={() => setSort((s) => ({ key: col.key, desc: s.key === col.key ? !s.desc : col.key !== "name" }))}
                        >
                          {col.label}
                          {sort.key === col.key && <span className="ml-1 text-[#c4121a]">{sort.desc ? "▼" : "▲"}</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ececf0] tabular-nums">
                    {sortedRows.map((r) => (
                      <tr key={r.branchId} className="cursor-pointer hover:bg-[#f5f5f7]" onClick={() => navigate({ branches: [r.branchId] })}>
                        <td className="sticky left-0 bg-white px-3 py-2 font-semibold text-[#1d1d1f]">{r.name} →</td>
                        {COMPARISON_COLUMNS.map((col) => (
                          <td
                            key={col.key}
                            className={`px-3 py-2 text-right ${col.key === "detectedAmount" && r.detectedAmount < 0 ? "font-semibold text-[#9a000d]" : ""} ${
                              sort.key === col.key ? "bg-[#f5f5f7]/60 font-semibold" : ""
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
        </Reveal>
      </div>
    </div>
  );
}
