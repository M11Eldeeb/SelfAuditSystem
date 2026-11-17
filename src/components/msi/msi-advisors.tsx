"use client";

import { Fragment, useMemo, useState } from "react";
import { Card, Label, Panel } from "@/components/dashboard/ui";
import { Bar, Chips, Empty, MONTHS, Pct, TableWrap, money, pct, td, tdr, th, thr } from "@/components/msi/msi-ui";
import type { AdvisorRow, MsiExtra, MsiReport } from "@/lib/msi/types";

const hasFigures = (a: AdvisorRow) => (a.achievement.total ?? 0) !== 0 || (a.target.total ?? 0) !== 0 || a.daily.length > 0;
const branchLabel = (b: string) => b.replace(/^([A-Z]\d)\s+/, "$1 · ");

/** Service advisors: what each has sold this month (labor and parts) against the target, the run rate and the daily detail. */
export function AdvisorsTab({ report, extra }: { report: MsiReport; extra: MsiExtra | null }) {
  const all = report.advisors;
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("all");
  const [withoutFigures, setWithoutFigures] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const regions = useMemo(() => [...new Set(all.filter((a) => a.kind === "advisor").map((a) => a.region).filter(Boolean))], [all]);
  const grand = all.find((a) => a.kind === "total");
  const filtering = !!q.trim() || region !== "all";
  const rows = all.filter((a) => {
    if (a.kind !== "advisor") return !filtering && a.kind === "region" ? true : !filtering && a.kind === "total";
    if (!withoutFigures && !hasFigures(a)) return false;
    if (region !== "all" && a.region !== region) return false;
    const w = q.toLowerCase().split(/\s+/).filter(Boolean);
    return !w.length || w.every((x) => `${a.name} ${a.branch}`.toLowerCase().includes(x));
  });
  const targets = extra?.saTargets ?? [];
  const m = report.meta;

  const cols = 11;
  return (
    <>
      {grand && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <Label>Sold by advisors · month to date</Label>
            <div className="font-display text-[1.75rem] leading-tight font-bold tracking-tight tabular-nums text-[#1d1d1f]">{money(grand.achievement.total)}</div>
            <p className="mt-1 text-xs text-[#6e6e73]">
              Labor {money(grand.achievement.labor)} · Parts {money(grand.achievement.parts)}
            </p>
          </Card>
          <Card>
            <Label>Month target</Label>
            <div className="font-display text-[1.75rem] leading-tight font-bold tracking-tight tabular-nums text-[#1d1d1f]">{money(grand.target.total)}</div>
            <p className="mt-1 text-xs text-[#6e6e73]">
              <Pct v={grand.pctMonth} good={m.workingDays ? (m.daysPassed ?? 0) / m.workingDays : 1} /> reached
            </p>
            <div className="mt-2">
              <Bar v={grand.pctMonth} color="#2d2d2d" />
            </div>
          </Card>
          <Card>
            <Label>Against the month-to-date target</Label>
            <div className="font-display text-[1.75rem] leading-tight font-bold tracking-tight tabular-nums">
              <Pct v={grand.pctMtd} />
            </div>
            <div className="mt-2">
              <Bar v={grand.pctMtd} />
            </div>
          </Card>
          <Card>
            <Label>Run rate · closing forecast</Label>
            <div className="font-display text-[1.75rem] leading-tight font-bold tracking-tight tabular-nums text-[#1d1d1f]">{money(grand.runrate)}</div>
            <p className="mt-1 text-xs text-[#6e6e73]">
              <Pct v={grand.runrate != null && grand.target.total ? grand.runrate / grand.target.total : null} /> of the month target
            </p>
          </Card>
        </div>
      )}

      <Panel
        title="Service advisors"
        eyebrow="Actual · target · run rate"
        subtitle="Labor and parts sold per advisor this month against the monthly target; click an advisor for the day-by-day figures"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search advisor or branch" aria-label="Search advisors" className="h-9 w-56 max-w-full rounded-lg border border-[#d4d4d4] bg-white px-3 text-[13px] shadow-sm" />
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Chips value={region} onChange={setRegion} label="Region" items={[{ id: "all", label: "All regions" }, ...regions.map((r) => ({ id: r, label: r }))]} />
          <label className="flex items-center gap-1.5 text-[13px] text-[#6e6e73]">
            <input type="checkbox" checked={withoutFigures} onChange={(e) => setWithoutFigures(e.target.checked)} />
            Show advisors with no figures
          </label>
        </div>
        {rows.length === 0 ? (
          <Empty>No advisor matches.</Empty>
        ) : (
          <TableWrap>
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="bg-[#f5f5f7]">
                <tr>
                  <th className={th}>Advisor</th>
                  <th className={th}>Branch</th>
                  <th className={thr}>Month target</th>
                  <th className={thr}>Labor</th>
                  <th className={thr}>Parts</th>
                  <th className={thr}>Total sold</th>
                  <th className={thr}>vs MTD</th>
                  <th className={thr}>Reached</th>
                  <th className={thr}>Run rate</th>
                  <th className={thr}>Daily target</th>
                  <th className={thr}>Needed per day</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ececec]">
                {rows.map((a, i) => {
                  const key = `${a.kind}|${a.name}|${i}`;
                  const isAdv = a.kind === "advisor";
                  const open = openRow === key;
                  const t = targets.find((x) => x.advisor.toLowerCase() === a.name.toLowerCase() && a.branch.startsWith(x.branch));
                  return (
                    <Fragment key={key}>
                      <tr onClick={() => isAdv && setOpenRow(open ? null : key)} className={`${isAdv ? "cursor-pointer hover:bg-[#f9f9fb]" : "bg-[#f5f5f7] font-semibold"} ${open ? "bg-[#f9f9fb]" : ""} ${isAdv && !hasFigures(a) ? "text-[#6e6e73]" : ""}`}>
                        <td className={td}>
                          {isAdv && <span className={`me-1 inline-block transition-transform ${open ? "rotate-90" : ""}`}>›</span>}
                          {a.name}
                        </td>
                        <td className={`${td} text-[#6e6e73]`}>{isAdv ? branchLabel(a.branch) : ""}</td>
                        <td className={tdr}>{a.targetNote && !a.target.total ? <span className="text-xs text-[#6e6e73]">{a.targetNote}</span> : money(a.target.total)}</td>
                        <td className={tdr}>{money(a.achievement.labor)}</td>
                        <td className={tdr}>{money(a.achievement.parts)}</td>
                        <td className={`${tdr} font-semibold`}>{money(a.achievement.total)}</td>
                        <td className={tdr}>
                          <Pct v={a.pctMtd} />
                        </td>
                        <td className={tdr}>
                          <Pct v={a.pctMonth} good={m.workingDays ? (m.daysPassed ?? 0) / m.workingDays : 1} />
                        </td>
                        <td className={tdr}>{money(a.runrate)}</td>
                        <td className={tdr}>{money(a.avgDailyTarget)}</td>
                        <td className={tdr}>{money(a.revisedDailyTarget)}</td>
                      </tr>
                      {open && (
                        <tr className="bg-[#fafafa]">
                          <td colSpan={cols} className="px-4 pb-4">
                            <div className="grid gap-4 lg:grid-cols-2">
                              <div>
                                <p className="mb-1.5 text-xs font-semibold text-[#6e6e73]">Day by day this month</p>
                                {a.daily.length ? (
                                  <TableWrap>
                                    <table className="w-full text-xs">
                                      <thead className="bg-[#f5f5f7]">
                                        <tr>
                                          <th className={th}>Day</th>
                                          <th className={thr}>Labor</th>
                                          <th className={thr}>Parts</th>
                                          <th className={thr}>Total</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-[#ececec]">
                                        {a.daily.map(([d, l, p, tot]) => (
                                          <tr key={d}>
                                            <td className={td}>{d}</td>
                                            <td className={tdr}>{money(l)}</td>
                                            <td className={tdr}>{money(p)}</td>
                                            <td className={tdr}>{money(tot ?? (l ?? 0) + (p ?? 0))}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </TableWrap>
                                ) : (
                                  <p className="text-xs text-[#6e6e73]">No sales recorded this month.</p>
                                )}
                              </div>
                              <div className="space-y-3">
                                {Object.keys(a.earlier).length > 0 && (
                                  <div>
                                    <p className="mb-1.5 text-xs font-semibold text-[#6e6e73]">Earlier months</p>
                                    <TableWrap>
                                      <table className="w-full text-xs">
                                        <thead className="bg-[#f5f5f7]">
                                          <tr>
                                            <th className={th}>Month</th>
                                            <th className={thr}>Labor</th>
                                            <th className={thr}>Parts</th>
                                            <th className={thr}>Total</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-[#ececec]">
                                          {Object.entries(a.earlier)
                                            .sort()
                                            .map(([mo, v]) => (
                                              <tr key={mo}>
                                                <td className={td}>{MONTHS[Number(mo.slice(5, 7)) - 1]} {mo.slice(0, 4)}</td>
                                                <td className={tdr}>{money(v.labor)}</td>
                                                <td className={tdr}>{money(v.parts)}</td>
                                                <td className={tdr}>{money(v.total)}</td>
                                              </tr>
                                            ))}
                                        </tbody>
                                      </table>
                                    </TableWrap>
                                  </div>
                                )}
                                {t && (
                                  <div>
                                    <p className="mb-1.5 text-xs font-semibold text-[#6e6e73]">Monthly labor target (SA Targets)</p>
                                    <div className="grid grid-cols-6 gap-1 text-center text-[11px]">
                                      {t.months.map((v, mi) => (
                                        <div key={mi} className="rounded-md bg-white px-1 py-1 ring-1 ring-[#ececec]">
                                          <div className="text-[#6e6e73]">{MONTHS[mi]}</div>
                                          <div className="font-semibold tabular-nums">{typeof v === "number" ? money(v) : (v ?? "—")}</div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                <p className="text-xs text-[#6e6e73]">
                                  Month target: labor {money(a.target.labor)} · parts {money(a.target.parts)} · total {money(a.target.total)} · {pct(a.pctMonth)} reached
                                </p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        <p className="mt-3 text-xs text-[#6e6e73]">Run rate: what the advisor ends the month on if he keeps selling at the pace so far. Needed per day: what he must sell on each remaining working day to reach the month target.</p>
      </Panel>
    </>
  );
}
