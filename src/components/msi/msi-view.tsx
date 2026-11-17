"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getMsiExtra, refreshMsi } from "@/app/admin/msi/actions";
import { Card, Label, Panel, Pill } from "@/components/dashboard/ui";
import { C, GroupedColumns } from "@/components/dashboard/charts";
import { CarLoaderCard } from "@/components/spinner";
import { AdvisorsTab } from "@/components/msi/msi-advisors";
import { DailyTab, KpisTab, MonthlyTab, WholesaleTab } from "@/components/msi/msi-more";
import { Bar, Chips, Empty, Pct, TableWrap, dec, fmtDay, money, pct, td, tdr, th, thr } from "@/components/msi/msi-ui";
import type { MsiExtra, MsiReport, SalesRow } from "@/lib/msi/types";

type Tab = "branches" | "advisors" | "daily" | "monthly" | "kpis" | "wholesale";
const TABS: { id: Tab; label: string; needsExtra: boolean }[] = [
  { id: "branches", label: "Branches", needsExtra: false },
  { id: "advisors", label: "Advisors", needsExtra: false },
  { id: "daily", label: "Daily sales", needsExtra: true },
  { id: "monthly", label: "Monthly closing", needsExtra: true },
  { id: "kpis", label: "KPIs", needsExtra: true },
  { id: "wholesale", label: "Wholesale & Affiliates", needsExtra: false },
];

type ExtraState = { status: "idle" | "loading" | "ready" | "missing" | "failed"; data: MsiExtra | null };

/** The page: the report's date and the tabs. The big sheets (daily, monthly closing, KPIs, advisor targets) load when first needed. */
export function MsiView({ report, dates, isLatest, canRefresh, importNote }: { report: MsiReport | null; dates: string[]; isLatest: boolean; canRefresh: boolean; importNote: string | null }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("branches");
  const [extra, setExtra] = useState<ExtraState>({ status: "idle", data: null });
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [busy, startRefresh] = useTransition();

  const needsExtra = TABS.find((t) => t.id === tab)?.needsExtra || tab === "advisors";
  const reportDate = report?.reportDate;
  useEffect(() => {
    if (!needsExtra || !reportDate || extra.status !== "idle") return;
    let live = true;
    queueMicrotask(() => live && setExtra({ status: "loading", data: null }));
    getMsiExtra(reportDate).then(
      (data) => live && setExtra(data ? { status: "ready", data } : { status: "missing", data: null }),
      () => live && setExtra({ status: "failed", data: null })
    );
    return () => {
      live = false;
    };
  }, [needsExtra, reportDate, extra.status]);

  function refresh() {
    setRefreshNote(null);
    startRefresh(async () => {
      const r = await refreshMsi();
      setRefreshNote(
        r.status === "imported" ? `Updated: report of ${fmtDay(r.reportDate)}.` : r.status === "unchanged" ? "No newer report than the one shown." : r.status === "not-found" ? "No Major Service Indicators e-mail found." : r.status === "not-connected" ? "The report mailbox is not connected." : r.error
      );
      setExtra({ status: "idle", data: null });
      router.refresh();
    });
  }

  if (!report)
    return (
      <div className="space-y-5">
        <Header title="Major Service Indicators" />
        <Panel title="No report yet" subtitle="The data analyst's daily Major Service Indicators e-mail has not been read yet.">
          <p className="text-sm text-[#6e6e73]">{importNote ?? "It is read every morning from the mailbox the Warranty Invoicing report comes in."}</p>
          {canRefresh && (
            <button type="button" onClick={refresh} disabled={busy} className="mt-3 rounded-lg bg-[#c4121a] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#a30f16] disabled:opacity-50">
              {busy ? "Reading the e-mail…" : "Read the newest e-mail now"}
            </button>
          )}
          {refreshNote && <p className="mt-2 text-sm text-[#6e6e73]">{refreshNote}</p>}
        </Panel>
      </div>
    );

  const m = report.meta;
  return (
    <div className="space-y-5">
      <Header
        title="Major Service Indicators"
        sub={`Report of ${fmtDay(report.reportDate)} · ${m.workingDays ?? "?"} working days in the month, ${m.daysPassed ?? "?"} passed, ${m.daysRemaining ?? "?"} left · amounts in SAR`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Report date"
              value={report.reportDate}
              onChange={(e) => router.push(`/admin/msi?date=${e.target.value}`)}
              className="h-9 rounded-lg border border-[#d4d4d4] bg-white px-2.5 text-[13px] font-medium text-[#1d1d1f] shadow-sm"
            >
              {dates.map((d) => (
                <option key={d} value={d}>
                  {fmtDay(d)}
                </option>
              ))}
            </select>
            {canRefresh && (
              <button type="button" onClick={refresh} disabled={busy} className="h-9 rounded-lg border border-[#d4d4d4] bg-white px-3 text-[13px] font-semibold text-[#1d1d1f] shadow-sm hover:bg-[#f5f5f7] disabled:opacity-50">
                {busy ? "Looking…" : "Refresh from e-mail"}
              </button>
            )}
          </div>
        }
      />
      <p className="px-1 text-xs text-[#6e6e73]">
        {report.receivedAt ? `E-mail received ${new Date(report.receivedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Riyadh" })} (Saudi time). ` : ""}
        Read automatically every morning (the report is not sent on Fridays and Saturdays, except on a month&apos;s last day).
        {!isLatest && <span className="ml-1 font-semibold text-[#b45309]">This is an earlier day, not the newest report.</span>}
        {refreshNote && <span className="ml-1 font-semibold text-[#1d1d1f]">{refreshNote}</span>}
      </p>

      <nav aria-label="Major Service Indicators sections" className="sticky top-[72px] z-10 -mx-1 px-1 py-1">
        <div className="flex gap-0.5 overflow-x-auto rounded-[14px] bg-[#e9e9ec]/85 p-[3px] backdrop-blur-xl">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={t.id === tab ? "page" : undefined}
              className={`flex min-h-9 flex-1 shrink-0 items-center justify-center rounded-[11px] px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-all ${
                t.id === tab ? "bg-white text-[#1d1d1f] shadow-[0_1px_3px_rgba(0,0,0,0.12),0_1px_1px_rgba(0,0,0,0.04)]" : "text-neutral-700 hover:bg-white/50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="min-w-0 space-y-5">
        {tab === "branches" && <BranchesTab report={report} />}
        {tab === "advisors" && <AdvisorsTab report={report} extra={extra.data} />}
        {tab === "wholesale" && <WholesaleTab report={report} />}
        {(tab === "daily" || tab === "monthly" || tab === "kpis") &&
          (extra.status === "ready" && extra.data ? (
            <>
              {tab === "daily" && <DailyTab report={report} extra={extra.data} />}
              {tab === "monthly" && <MonthlyTab report={report} extra={extra.data} />}
              {tab === "kpis" && <KpisTab report={report} extra={extra.data} />}
            </>
          ) : extra.status === "missing" ? (
            <Empty>The detailed sheets (daily sales, monthly closing, KPIs) are kept for the newest report only. Choose the newest date.</Empty>
          ) : extra.status === "failed" ? (
            <Empty>Could not load this part of the report. Try again.</Empty>
          ) : (
            <CarLoaderCard label="Loading the report…" />
          ))}
      </div>
    </div>
  );
}

function Header({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 px-1">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-[#6e6e73]">Aftersales</p>
        <h1 className="text-[28px] leading-tight font-bold tracking-tight text-[#1d1d1f]">{title}</h1>
        {sub && <p className="mt-1 text-[15px] text-[#6e6e73]">{sub}</p>}
      </div>
      {right}
    </header>
  );
}

// ---------- Branches ----------

const isClosed = (r: SalesRow | undefined) => !r || (r.actual == null && r.mtdTarget == null && !r.forecast);

function BranchesTab({ report }: { report: MsiReport }) {
  const m = report.meta;
  const ksa = report.sales.find((r) => r.scope === "KSA" && r.type === "Aftersales Total") ?? report.sales.find((r) => r.scope === "KSA");
  const branches = useMemo(() => {
    const seen = new Map<string, { scope: string; name: string; total: SalesRow | undefined }>();
    for (const r of report.sales) {
      if (r.scope === "KSA") continue;
      const e = seen.get(r.scope) ?? { scope: r.scope, name: r.scopeName, total: undefined };
      if (r.type === "Branch total") e.total = r;
      seen.set(r.scope, e);
    }
    const list = [...seen.values()];
    return list.sort((a, b) => Number(isClosed(a.total)) - Number(isClosed(b.total)) || (b.total?.actual ?? 0) - (a.total?.actual ?? 0));
  }, [report.sales]);
  const open = branches.filter((b) => !isClosed(b.total));
  const [scope, setScope] = useState("KSA");
  const detail = report.sales.filter((r) => r.scope === scope);
  const forecastVs = (r: SalesRow | undefined) => (r?.forecast != null && r.monthTarget ? r.forecast / r.monthTarget : null);

  return (
    <>
      {ksa && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <Label>Actual · month to date</Label>
            <div className="font-display text-[1.75rem] leading-tight font-bold tracking-tight tabular-nums text-[#1d1d1f]">{money(ksa.actual)}</div>
            <p className="mt-1 text-xs text-[#6e6e73]">
              MTD target {money(ksa.mtdTarget)} · <Pct v={ksa.mtdPct} />
            </p>
            <div className="mt-2">
              <Bar v={ksa.mtdPct} />
            </div>
          </Card>
          <Card>
            <Label>Month target</Label>
            <div className="font-display text-[1.75rem] leading-tight font-bold tracking-tight tabular-nums text-[#1d1d1f]">{money(ksa.monthTarget)}</div>
            <p className="mt-1 text-xs text-[#6e6e73]">
              <Pct v={ksa.monthPct} good={m.workingDays ? (m.daysPassed ?? 0) / m.workingDays : 1} /> reached · {m.daysRemaining ?? "?"} working days left
            </p>
            <div className="mt-2">
              <Bar v={ksa.monthPct} color="#2d2d2d" />
            </div>
          </Card>
          <Card>
            <Label>Closing forecast</Label>
            <div className="font-display text-[1.75rem] leading-tight font-bold tracking-tight tabular-nums text-[#1d1d1f]">{money(ksa.forecast)}</div>
            <p className="mt-1 text-xs text-[#6e6e73]">
              <Pct v={forecastVs(ksa)} /> of the month target
            </p>
            <div className="mt-2">
              <Bar v={forecastVs(ksa)} color="#248a3d" />
            </div>
          </Card>
          <Card>
            <Label>Year to date</Label>
            <div className="font-display text-[1.75rem] leading-tight font-bold tracking-tight tabular-nums text-[#1d1d1f]">{money(report.sales.find((r) => r.scope === "KSA" && r.type === "Service Total" && r.channel === "with others")?.ytdActual ?? ksa.ytdActual)}</div>
            <p className="mt-1 text-xs text-[#6e6e73]">Service total, all branches. Year-to-date figures are as the report has them.</p>
          </Card>
        </div>
      )}

      <Panel title="Branches" subtitle="Aftersales total of each branch (workshop and parts counter). Click a branch to see its lines below." eyebrow="Actual · MTD target · month target · closing forecast">
        <TableWrap>
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-[#f5f5f7]">
              <tr>
                <th className={th}>Branch</th>
                <th className={thr}>Actual (MTD)</th>
                <th className={thr}>MTD target</th>
                <th className={thr}>vs MTD</th>
                <th className={thr}>Month target</th>
                <th className={thr}>Reached</th>
                <th className={thr}>Closing forecast</th>
                <th className={thr}>Forecast vs target</th>
                <th className={thr}>YTD actual</th>
                <th className={thr}>YTD target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ececec]">
              {ksa && (
                <tr className="bg-[#fafafa] font-semibold">
                  <td className={td}>KSA total</td>
                  <td className={tdr}>{money(ksa.actual)}</td>
                  <td className={tdr}>{money(ksa.mtdTarget)}</td>
                  <td className={tdr}>
                    <Pct v={ksa.mtdPct} />
                  </td>
                  <td className={tdr}>{money(ksa.monthTarget)}</td>
                  <td className={tdr}>
                    <Pct v={ksa.monthPct} good={m.workingDays ? (m.daysPassed ?? 0) / m.workingDays : 1} />
                  </td>
                  <td className={tdr}>{money(ksa.forecast)}</td>
                  <td className={tdr}>
                    <Pct v={forecastVs(ksa)} />
                  </td>
                  <td className={tdr}>{money(ksa.ytdActual)}</td>
                  <td className={tdr}>{money(ksa.ytdTarget)}</td>
                </tr>
              )}
              {branches.map(({ scope: code, name, total }) =>
                isClosed(total) ? (
                  <tr key={code} className="text-[#6e6e73]">
                    <td className={td}>{name}</td>
                    <td className={`${td} italic`} colSpan={7}>
                      No figures this month in the report (closed or not calculated)
                    </td>
                    <td className={tdr}>{money(total?.ytdActual)}</td>
                    <td className={tdr}>{money(total?.ytdTarget)}</td>
                  </tr>
                ) : (
                  <tr key={code} className="cursor-pointer hover:bg-[#f9f9fb]" onClick={() => setScope(code)}>
                    <td className={`${td} font-medium`}>
                      {name} <span className="text-xs text-[#6e6e73]">{code}</span>
                    </td>
                    <td className={tdr}>{money(total?.actual)}</td>
                    <td className={tdr}>{money(total?.mtdTarget)}</td>
                    <td className={tdr}>
                      <Pct v={total?.mtdPct} />
                    </td>
                    <td className={tdr}>{money(total?.monthTarget)}</td>
                    <td className={tdr}>
                      <Pct v={total?.monthPct} good={m.workingDays ? (m.daysPassed ?? 0) / m.workingDays : 1} />
                    </td>
                    <td className={tdr}>{money(total?.forecast)}</td>
                    <td className={tdr}>
                      <Pct v={forecastVs(total)} />
                    </td>
                    <td className={tdr}>{money(total?.ytdActual)}</td>
                    <td className={tdr}>{money(total?.ytdTarget)}</td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </TableWrap>
      </Panel>

      {open.length > 0 && (
        <Panel title="Actual against the month-to-date target" subtitle="Each branch: what it has sold so far and what it should have sold by now">
          <GroupedColumns
            groups={open.map((b) => ({ label: b.name, values: [b.total?.actual ?? 0, b.total?.mtdTarget ?? 0] as [number, number] }))}
            seriesNames={["Actual", "MTD target"]}
            colors={[C.red, C.blueLight]}
            format={(v) => money(v)}
          />
        </Panel>
      )}

      <Panel
        title="Every line of the report"
        subtitle="Workshop (service, labor, consumables, sublet), parts (workshop, lubes, counter) by internal, retail and warranty"
        action={
          <Chips
            label="Branch"
            value={scope}
            onChange={setScope}
            items={[{ id: "KSA", label: "KSA" }, ...branches.filter((b) => !isClosed(b.total)).map((b) => ({ id: b.scope, label: b.name }))]}
          />
        }
      >
        {(["Totals", "Breakdown"] as const).map((part) => {
          const rows = detail.filter((r) => r.part === part);
          if (!rows.length) return null;
          return (
            <div key={part} className="mb-5 last:mb-0">
              <p className="mb-2 text-[13px] font-semibold text-[#1d1d1f]">{part === "Totals" ? "Totals" : "Breakdown"}</p>
              <TableWrap>
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="bg-[#f5f5f7]">
                    <tr>
                      <th className={th}>Line</th>
                      <th className={thr}>Actual (MTD)</th>
                      <th className={thr}>MTD target</th>
                      <th className={thr}>vs MTD</th>
                      <th className={thr}>Month target</th>
                      <th className={thr}>Reached</th>
                      <th className={thr}>Closing forecast</th>
                      <th className={thr}>YTD actual</th>
                      <th className={thr}>YTD target</th>
                      <th className={thr}>YTD %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ececec]">
                    {rows.map((r, i) => {
                      const head = i === 0 || rows[i - 1].type !== r.type;
                      return (
                        <tr key={`${r.type}|${r.channel}|${i}`} className={head ? "bg-[#fcfcfd]" : ""}>
                          <td className={td}>
                            {head && <span className="font-semibold text-[#1d1d1f]">{r.type}</span>}
                            {head ? <span className="text-[#6e6e73]"> · {r.channel}</span> : <span className="pl-4 text-[#6e6e73]">{r.channel}</span>}
                          </td>
                          <td className={tdr}>{money(r.actual)}</td>
                          <td className={tdr}>{money(r.mtdTarget)}</td>
                          <td className={tdr}>
                            <Pct v={r.mtdPct} />
                          </td>
                          <td className={tdr}>{money(r.monthTarget)}</td>
                          <td className={tdr}>
                            <Pct v={r.monthPct} good={m.workingDays ? (m.daysPassed ?? 0) / m.workingDays : 1} />
                          </td>
                          <td className={tdr}>{money(r.forecast)}</td>
                          <td className={tdr}>{money(r.ytdActual)}</td>
                          <td className={tdr}>{money(r.ytdTarget)}</td>
                          <td className={tdr}>{pct(r.ytdPct)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            </div>
          );
        })}
        {!detail.length && <Empty>No lines for this branch.</Empty>}
        <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#6e6e73]">
          <Pill tone="muted">vs MTD</Pill> what was sold against the target for the days passed
          <Pill tone="muted">Reached</Pill> against the whole month&apos;s target
          <Pill tone="muted">Closing forecast</Pill> the report&apos;s projection of the month&apos;s end ({dec(report.meta.daysPassed, 0)} of {dec(report.meta.workingDays, 0)} working days passed)
        </p>
      </Panel>
    </>
  );
}
