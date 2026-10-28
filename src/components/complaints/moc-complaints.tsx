"use client";

import { Fragment, useMemo, useState } from "react";
import type { Complaint, ComplaintsData } from "@/app/actions/complaints";
import { refreshComplaints } from "@/app/actions/complaints";
import { monthShort } from "@/components/dashboard/charts";
import { Panel, fmtDate, fmtInt, fmtNum } from "@/components/dashboard/ui";
import { Glyph } from "@/components/ui/glyph";
import { Change, Heatmap, Kpi, MonthColumns, PERIODS, Segmented, count, monthsBetween, periodRange, type PeriodKey } from "./shared";

const SOURCES = [
  { key: "MOC", label: "MOC", color: "#1d1d1f" },
  { key: "SAIC", label: "SAIC", color: "#c4121a" },
  { key: "CRM", label: "CRM", color: "#aeaeb2" },
];
const VALID = "#c4121a";
const NOT_VALID = "#d1d1d6";
const UNKNOWN = "#f2f2f7";
const isClosed = (s: string | null) => /clos|resolv|done|complet/i.test(s ?? "");
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);

/** Valid / not valid as one thin bar. */
function ValidBar({ valid, notValid, unknown }: { valid: number; notValid: number; unknown: number }) {
  const t = valid + notValid + unknown || 1;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-neutral-900/[0.05]">
      <span style={{ width: `${(valid / t) * 100}%`, backgroundColor: VALID }} />
      <span style={{ width: `${(notValid / t) * 100}%`, backgroundColor: NOT_VALID }} />
      <span style={{ width: `${(unknown / t) * 100}%`, backgroundColor: UNKNOWN }} />
    </div>
  );
}

type Stat = { total: number; valid: number; notValid: number; unknown: number; open: number; resolveDays: number[] };
const stat = (list: Complaint[]): Stat => ({
  total: list.length,
  valid: list.filter((c) => c.valid === true).length,
  notValid: list.filter((c) => c.valid === false).length,
  unknown: list.filter((c) => c.valid == null).length,
  open: list.filter((c) => !isClosed(c.status)).length,
  resolveDays: list.filter((c) => c.created && c.resolved).map((c) => Math.max(0, days(c.created!, c.resolved!))),
});
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export function MocComplaints({ data, onReload }: { data: ComplaintsData; onReload: () => void }) {
  const [period, setPeriod] = useState<PeriodKey>("6m");
  const [source, setSource] = useState("all");
  const [branch, setBranch] = useState("all");
  const [validity, setValidity] = useState<"all" | "valid" | "not">("all");
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const all = data.complaints;
  const firstMonth = all.find((c) => c.created)?.created?.slice(0, 7) ?? null;
  const range = periodRange(period, data.today, firstMonth);
  const months = monthsBetween(range.from, range.to);
  const branches = useMemo(() => [...new Set(all.map((c) => c.branch))].sort(), [all]);

  const pick = (c: Complaint) =>
    (source === "all" || c.source === source) && (branch === "all" || c.branch === branch) && (validity === "all" || (validity === "valid" ? c.valid === true : c.valid === false));
  const inRange = (c: Complaint, from: string | null, to: string | null) => !!c.created && !!from && !!to && c.created.slice(0, 7) >= from && c.created.slice(0, 7) <= to;
  const list = all.filter((c) => pick(c) && inRange(c, range.from, range.to));
  const prev = range.prevFrom ? all.filter((c) => pick(c) && inRange(c, range.prevFrom, range.prevTo)) : null;
  const s = stat(list);
  const ps = prev ? stat(prev) : null;
  const avgResolve = avg(s.resolveDays);

  // Repeat VINs: the same car complained about more than once in the period.
  const byVin = new Map<string, Complaint[]>();
  for (const c of list) if (c.vin && c.vin.length >= 10) byVin.set(c.vin, [...(byVin.get(c.vin) ?? []), c]);
  const repeats = [...byVin.entries()].filter(([, l]) => l.length > 1).sort((a, b) => b[1].length - a[1].length);

  // Per branch.
  const branchRows = branches
    .map((b) => {
      const l = list.filter((c) => c.branch === b);
      const p = prev?.filter((c) => c.branch === b);
      return { branch: b, s: stat(l), bySource: count(l, (c) => c.source), prevTotal: p ? p.length : null };
    })
    .filter((r) => r.s.total || (r.prevTotal ?? 0))
    .sort((a, b) => b.s.valid - a.s.valid || b.s.total - a.s.total);

  // Categories and subcategories.
  const cats = [...count(list, (c) => c.category).entries()].sort((a, b) => b[1] - a[1]);
  const topCats = cats.slice(0, 8).map(([c]) => c);
  const advisors = [...count(list.filter((c) => c.valid === true && c.advisor), (c) => `${c.advisor}|${c.branch}`).entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  // What needs action.
  const insights: { tone: "bad" | "warn" | "info"; text: string }[] = [];
  if (s.total) {
    const networkRate = pct(s.valid, s.valid + s.notValid);
    const worst = branchRows.filter((r) => r.s.valid >= 3).sort((a, b) => pct(b.s.valid, b.s.valid + b.s.notValid) - pct(a.s.valid, a.s.valid + a.s.notValid))[0];
    if (worst && branch === "all")
      insights.push({
        tone: "bad",
        text: `${worst.branch}: ${fmtInt(worst.s.valid)} valid complaints - ${pct(worst.s.valid, worst.s.valid + worst.s.notValid).toFixed(0)}% of its complaints are valid (all branches ${networkRate.toFixed(0)}%). Review its root causes first.`,
      });
    const validCats = [...count(list.filter((c) => c.valid === true), (c) => `${c.category} › ${c.subcategory}`).entries()].sort((a, b) => b[1] - a[1]);
    if (validCats[0]) insights.push({ tone: "bad", text: `Top valid cause: ${validCats[0][0]} (${fmtInt(validCats[0][1])}, ${pct(validCats[0][1], s.valid).toFixed(0)}% of valid complaints).` });
    if (prev) {
      const before = count(prev, (c) => c.category);
      const growth = cats
        .map(([c, n]) => ({ c, n, b: before.get(c) ?? 0 }))
        .filter((x) => x.n >= 5 && x.n > x.b)
        .sort((a, b) => b.n - b.b - (a.n - a.b))[0];
      if (growth) insights.push({ tone: "warn", text: `${growth.c} is rising: ${fmtInt(growth.n)} complaints vs ${fmtInt(growth.b)} in the previous period.` });
    }
    if (repeats.length) insights.push({ tone: "warn", text: `${fmtInt(repeats.length)} car${repeats.length === 1 ? "" : "s"} complained about more than once - repeat complaints usually mean the first fix did not hold.` });
    const lateOpen = list.filter((c) => !isClosed(c.status) && c.created && days(c.created, data.today) > 7).length;
    if (lateOpen) insights.push({ tone: "bad", text: `${fmtInt(lateOpen)} complaint${lateOpen === 1 ? " is" : "s are"} still open after 7 days.` });
    if (advisors[0]) insights.push({ tone: "info", text: `Service advisor with the most valid complaints: ${advisors[0][0].split("|")[0]} (${advisors[0][0].split("|")[1]}, ${fmtInt(advisors[0][1])}).` });
  }

  async function refresh() {
    setBusy("Reading the e-mail…");
    const r = await refreshComplaints();
    setBusy(
      r.status === "imported"
        ? `Imported ${fmtInt(r.rows)} complaints from ${r.fileName}.`
        : r.status === "unchanged"
          ? "Already up to date."
          : r.status === "not-found"
            ? 'No "Tracker Report" e-mail with an Excel file found in the last 70 days.'
            : r.status === "not-connected"
              ? "The report mailbox is not connected (Claims & Financials > Warranty invoicing)."
              : r.error
    );
    if (r.status === "imported") onReload();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Period" value={period} options={PERIODS} onChange={setPeriod} />
          <Segmented label="Source" value={source} options={[{ key: "all", label: "All sources" }, ...SOURCES]} onChange={setSource} />
          <Segmented
            label="Validity"
            value={validity}
            options={[
              { key: "all", label: "All" },
              { key: "valid", label: "Valid" },
              { key: "not", label: "Not valid" },
            ]}
            onChange={setValidity}
          />
          {data.scope === "all" && (
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-[13px]" aria-label="Branch">
              <option value="all">All branches</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2 text-[12px] text-[#6e6e73]">
          {busy ?? (data.lastImport ? `Last file: ${data.lastImport.subject ?? data.lastImport.fileName} · ${fmtDate(data.lastImport.receivedAt)}` : "No file imported yet.")}
          {data.canRefresh && (
            <button type="button" onClick={() => void refresh()} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-[13px] font-medium text-neutral-700 shadow-sm hover:bg-neutral-50">
              <Glyph name="mail" /> Refresh from e-mail
            </button>
          )}
        </div>
      </div>

      {!all.length ? (
        <p className="rounded-2xl bg-white px-5 py-10 text-center text-[14px] text-[#6e6e73] ring-1 ring-black/[0.05]">
          No complaints yet. {data.canRefresh ? 'Press "Refresh from e-mail" to import the latest Complaints Tracker Report.' : "They appear after the monthly report is imported."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label="Complaints" value={fmtInt(s.total)} sub={<Change now={s.total} before={ps?.total ?? null} />} />
            <Kpi label="Valid" value={fmtInt(s.valid)} tone={s.valid ? "bad" : undefined} sub={`${pct(s.valid, s.valid + s.notValid).toFixed(0)}% of judged · ${fmtInt(s.notValid)} not valid`} />
            <Kpi label="Still open" value={fmtInt(s.open)} tone={s.open ? "bad" : "good"} sub={s.open ? "not closed in the file" : "all closed"} />
            <Kpi
              label="Avg. days to resolve"
              value={avgResolve == null || s.resolveDays.length < 10 ? "—" : fmtNum(avgResolve, 1)}
              sub={s.resolveDays.length < 10 ? `only ${fmtInt(s.resolveDays.length)} with a resolved date in the file` : `${fmtInt(s.resolveDays.length)} with a resolved date`}
            />
            <Kpi label="Repeat cars" value={fmtInt(repeats.length)} tone={repeats.length ? "bad" : undefined} sub="same VIN, 2+ complaints" />
          </div>

          {insights.length > 0 && (
            <Panel title="What needs action" subtitle={`${monthShort(range.from)} – ${monthShort(range.to)}${source === "all" ? "" : ` · ${source}`}${branch === "all" ? "" : ` · ${branch}`}`}>
              <ul className="space-y-2">
                {insights.map((i) => (
                  <li key={i.text} className="flex gap-2.5 text-[14px] text-[#1d1d1f]">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i.tone === "bad" ? "bg-[#d70015]" : i.tone === "warn" ? "bg-[#c93400]" : "bg-[#8e8e93]"}`} />
                    {i.text}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <div className="grid gap-5 lg:grid-cols-5">
            <Panel className="lg:col-span-3" title="Complaints per month" subtitle="By created date, stacked by source">
              <MonthColumns
                months={months}
                series={SOURCES}
                values={(m, k) => list.filter((c) => c.source === k && c.created?.startsWith(m)).length}
                note={(m) => {
                  const l = list.filter((c) => c.created?.startsWith(m));
                  return `${l.filter((c) => c.valid === true).length} valid`;
                }}
              />
            </Panel>
            <Panel className="lg:col-span-2" title="Valid vs not valid" subtitle="Per source">
              <div className="space-y-4">
                {SOURCES.map((src) => {
                  const st = stat(list.filter((c) => c.source === src.key));
                  return (
                    <div key={src.key} className="space-y-1.5">
                      <div className="flex items-baseline justify-between text-[13px]">
                        <span className="font-semibold text-[#1d1d1f]">{src.label}</span>
                        <span className="tabular-nums text-[#6e6e73]">
                          {fmtInt(st.total)} · <span className="font-semibold text-[#b10012]">{fmtInt(st.valid)} valid</span> ({pct(st.valid, st.valid + st.notValid).toFixed(0)}%)
                        </span>
                      </div>
                      <ValidBar valid={st.valid} notValid={st.notValid} unknown={st.unknown} />
                    </div>
                  );
                })}
                <div className="flex flex-wrap gap-4 pt-1 text-[12px] text-[#6e6e73]">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: VALID }} /> Valid
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: NOT_VALID }} /> Not valid
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm ring-1 ring-black/10" style={{ backgroundColor: UNKNOWN }} /> Not judged
                  </span>
                </div>
              </div>
            </Panel>
          </div>

          {data.scope === "all" && (
            <Panel title="Per branch" subtitle="Sorted by valid complaints. Change compares with the previous period of the same length.">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-[13px] tabular-nums">
                  <thead className="border-b border-neutral-200 text-left text-[12px] text-[#6e6e73]">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Branch</th>
                      <th className="px-3 py-2 text-right font-medium">Total</th>
                      <th className="px-3 py-2 font-medium">Valid</th>
                      {SOURCES.map((x) => (
                        <th key={x.key} className="px-3 py-2 text-right font-medium">
                          {x.label}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right font-medium">Open</th>
                      <th className="px-3 py-2 text-right font-medium">Avg. days</th>
                      <th className="py-2 pl-3 text-right font-medium">Change</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {branchRows.map((r) => {
                      const d = r.prevTotal == null ? null : r.s.total - r.prevTotal;
                      const ar = avg(r.s.resolveDays);
                      return (
                        <tr key={r.branch}>
                          <td className="py-2.5 pr-3 font-semibold text-[#1d1d1f]">{r.branch}</td>
                          <td className="px-3 py-2.5 text-right font-semibold">{fmtInt(r.s.total)}</td>
                          <td className="w-48 px-3 py-2.5">
                            <div className="mb-1 flex justify-between text-[12px]">
                              <span className="font-semibold text-[#b10012]">{fmtInt(r.s.valid)}</span>
                              <span className="text-[#6e6e73]">{pct(r.s.valid, r.s.valid + r.s.notValid).toFixed(0)}%</span>
                            </div>
                            <ValidBar valid={r.s.valid} notValid={r.s.notValid} unknown={r.s.unknown} />
                          </td>
                          {SOURCES.map((x) => (
                            <td key={x.key} className="px-3 py-2.5 text-right text-[#3a3a3c]">
                              {fmtInt(r.bySource.get(x.key) ?? 0)}
                            </td>
                          ))}
                          <td className={`px-3 py-2.5 text-right ${r.s.open ? "font-semibold text-[#d70015]" : "text-[#8e8e93]"}`}>{fmtInt(r.s.open)}</td>
                          <td className="px-3 py-2.5 text-right">{ar == null ? "—" : fmtNum(ar, 1)}</td>
                          <td className={`py-2.5 pl-3 text-right ${d == null ? "" : d > 0 ? "text-[#d70015]" : d < 0 ? "text-[#248a3d]" : "text-[#8e8e93]"}`}>{d == null ? "—" : d === 0 ? "0" : `${d > 0 ? "+" : "−"}${fmtInt(Math.abs(d))}`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Category and subcategory" subtitle="Click a category for its subcategories. Red = valid.">
              <div className="space-y-2.5">
                {cats.map(([cat, n]) => {
                  const l = list.filter((c) => c.category === cat);
                  const st = stat(l);
                  const open = openCat === cat;
                  const subs = [...count(l, (c) => c.subcategory).entries()].sort((a, b) => b[1] - a[1]);
                  return (
                    <Fragment key={cat}>
                      <button type="button" onClick={() => setOpenCat(open ? null : cat)} className="block w-full space-y-1 text-left" aria-expanded={open}>
                        <div className="flex items-baseline justify-between text-[13px]">
                          <span className="font-semibold text-[#1d1d1f]">
                            <span className={`me-1 inline-block text-[#8e8e93] transition-transform ${open ? "rotate-90" : ""}`}>›</span>
                            {cat}
                          </span>
                          <span className="tabular-nums text-[#6e6e73]">
                            {fmtInt(n)} · {pct(n, s.total).toFixed(0)}% · <span className="text-[#b10012]">{fmtInt(st.valid)} valid</span>
                          </span>
                        </div>
                        <div className="flex h-2 overflow-hidden rounded-full bg-neutral-900/[0.05]" style={{ width: `${Math.max(4, (n / (cats[0]?.[1] ?? 1)) * 100)}%` }}>
                          <span style={{ width: `${pct(st.valid, n)}%`, backgroundColor: VALID }} />
                          <span style={{ width: `${pct(st.notValid, n)}%`, backgroundColor: NOT_VALID }} />
                        </div>
                      </button>
                      {open && (
                        <div className="ms-4 space-y-1.5 border-s border-neutral-200 ps-3">
                          {subs.map(([sub, k]) => {
                            const v = l.filter((c) => c.subcategory === sub && c.valid === true).length;
                            return (
                              <div key={sub} className="flex items-baseline justify-between text-[12px]">
                                <span className="text-[#3a3a3c]">{sub}</span>
                                <span className="tabular-nums text-[#6e6e73]">
                                  {fmtInt(k)} · <span className="text-[#b10012]">{fmtInt(v)} valid</span>
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </Fragment>
                  );
                })}
              </div>
            </Panel>
            <Panel title="Service advisors - valid complaints" subtitle="Top 10 in the period">
              {advisors.length ? (
                <div className="space-y-2">
                  {advisors.map(([k, n]) => {
                    const [name, br] = k.split("|");
                    return (
                      <div key={k} className="space-y-1">
                        <div className="flex items-baseline justify-between text-[13px]">
                          <span>
                            <span className="font-semibold text-[#1d1d1f]">{name}</span> <span className="text-[#8e8e93]">· {br}</span>
                          </span>
                          <span className="font-semibold tabular-nums text-[#b10012]">{fmtInt(n)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-neutral-900/[0.05]">
                          <div className="h-full rounded-full" style={{ width: `${(n / advisors[0][1]) * 100}%`, backgroundColor: VALID }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-[#6e6e73]">No valid complaints with a service advisor in this period.</p>
              )}
            </Panel>
          </div>

          {data.scope === "all" && branch === "all" && topCats.length > 0 && (
            <Panel title="Branch × category" subtitle="All complaints in the period - darker = more. Spot where each problem concentrates.">
              <Heatmap rows={branchRows.map((r) => r.branch)} cols={topCats} value={(b, c) => list.filter((x) => x.branch === b && x.category === c).length} />
            </Panel>
          )}

          {repeats.length > 0 && (
            <Panel title="Repeat cars" subtitle="The same VIN with more than one complaint in the period">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-[13px]">
                  <thead className="border-b border-neutral-200 text-left text-[12px] text-[#6e6e73]">
                    <tr>
                      <th className="py-2 pr-3 font-medium">VIN</th>
                      <th className="px-3 py-2 text-right font-medium">Complaints</th>
                      <th className="px-3 py-2 font-medium">Branch</th>
                      <th className="px-3 py-2 font-medium">Categories</th>
                      <th className="py-2 pl-3 font-medium">Last</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {repeats.slice(0, 20).map(([vin, l]) => (
                      <tr key={vin}>
                        <td className="py-2 pr-3 font-mono text-[12px]">{vin}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{l.length}</td>
                        <td className="px-3 py-2">{[...new Set(l.map((c) => c.branch))].join(", ")}</td>
                        <td className="px-3 py-2 text-[#3a3a3c]">{[...new Set(l.map((c) => `${c.category} › ${c.subcategory}`))].join("; ")}</td>
                        <td className="py-2 pl-3 whitespace-nowrap">{fmtDate(l[l.length - 1].created)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {repeats.length > 20 && <p className="mt-2 text-[12px] text-[#6e6e73]">Showing 20 of {fmtInt(repeats.length)}.</p>}
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
