"use client";

import { useEffect, useMemo, useState } from "react";
import { getCourtesyCars, type CourtesyData } from "@/app/actions/courtesy";
import { Panel, fmtInt, fmtNum } from "@/components/dashboard/ui";
import { downloadXlsx, type ExportColumn } from "@/components/dashboard/sections/invoicing-export";
import { Kpi } from "@/components/complaints/shared";
import { CarLoaderCard } from "@/components/spinner";
import { Glyph } from "@/components/ui/glyph";
import { CopyText } from "@/components/copy-text";

const days = (from: string, to: string) => {
  const a = Date.parse(from);
  const b = Date.parse(to);
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.max(0, Math.round((b - a) / 86_400_000));
};
const countBy = (list: string[]) => {
  const m = new Map<string, number>();
  for (const x of list) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

function Bars({ items, active, onPick }: { items: [string, number][]; active?: string; onPick?: (v: string) => void }) {
  const max = Math.max(...items.map((i) => i[1]), 1);
  return (
    <div className="space-y-2">
      {items.map(([label, n]) => (
        <button key={label} type="button" onClick={() => onPick?.(label)} className={`block w-full space-y-1 rounded-md text-left ${onPick ? "hover:bg-neutral-900/[0.03]" : "cursor-default"} ${active === label ? "bg-[#c4121a]/[0.06]" : ""}`}>
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="truncate font-medium text-[#1d1d1f]">{label}</span>
            <span className="font-semibold tabular-nums">{fmtInt(n)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-neutral-900/[0.05]">
            <div className="h-full rounded-full" style={{ width: `${(n / max) * 100}%`, backgroundColor: active === label ? "#c4121a" : "#3a3a3c" }} />
          </div>
        </button>
      ))}
    </div>
  );
}

/** A whole sheet as a searchable table (every column), with Excel export. */
function SheetTableView({ title, headers, rows, extra, copyCols, fileName }: { title: string; headers: string[]; rows: string[][]; extra?: { header: string; value: (i: number) => React.ReactNode; text: (i: number) => string }[]; copyCols: number[]; fileName: string }) {
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(50);
  const idx = rows.map((_, i) => i);
  const needle = q.trim().toUpperCase();
  const shown = needle ? idx.filter((i) => rows[i].some((c) => c.toUpperCase().includes(needle))) : idx;
  const exportCols: ExportColumn<number>[] = [...headers.map((h, j) => ({ header: h, value: (i: number) => rows[i][j] ?? "" })), ...(extra ?? []).map((e) => ({ header: e.header, value: e.text }))];
  return (
    <Panel
      title={`${title} (${fmtInt(shown.length)})`}
      action={
        <div className="flex items-center gap-2">
          <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(50); }} placeholder="Search plate, WIP, name…" className="w-56 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-[13px]" />
          <button type="button" onClick={() => void downloadXlsx(`${fileName}.xlsx`, title.slice(0, 30), exportCols, shown)} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-[13px] font-medium text-neutral-700 shadow-sm hover:bg-neutral-50">
            <Glyph name="download" /> Export
          </button>
        </div>
      }
    >
      <div className="max-h-[36rem] overflow-auto rounded-lg ring-1 ring-neutral-200">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-neutral-50 text-left text-[11px] text-[#6e6e73]">
            <tr>
              {(extra ?? []).map((e) => (
                <th key={e.header} className="px-2 py-2 font-medium whitespace-nowrap">
                  {e.header}
                </th>
              ))}
              {headers.map((h, j) => (
                <th key={j} className="px-2 py-2 font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {shown.slice(0, limit).map((i) => (
              <tr key={i} className="hover:bg-neutral-50">
                {(extra ?? []).map((e) => (
                  <td key={e.header} className="px-2 py-1.5 whitespace-nowrap">
                    {e.value(i)}
                  </td>
                ))}
                {headers.map((_, j) => (
                  <td key={j} className="max-w-[18rem] truncate px-2 py-1.5" title={rows[i][j]}>
                    {copyCols.includes(j) && rows[i][j] ? <CopyText value={rows[i][j]} className="font-mono" /> : rows[i][j]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > limit && (
        <div className="mt-3 text-center">
          <button type="button" onClick={() => setLimit((l) => l + 100)} className="rounded-lg bg-neutral-900/[0.06] px-4 py-1.5 text-[13px] font-medium">
            Show more ({fmtInt(shown.length - limit)} left)
          </button>
        </div>
      )}
    </Panel>
  );
}

/** Courtesy (replacement) cars: the fleet and its status, and the agreements - which cars are with customers, for how long. */
export function CourtesyView() {
  const [data, setData] = useState<CourtesyData | null>(null);
  const [tab, setTab] = useState<"agreements" | "vehicles">("agreements");
  const [branch, setBranch] = useState("all");
  const [status, setStatus] = useState("all");
  const [openOnly, setOpenOnly] = useState(true);

  useEffect(() => {
    getCourtesyCars().then(setData, () => setData(null));
  }, []);

  const derived = useMemo(() => {
    if (!data) return null;
    const vc = data.cols.vehicles;
    const ac = data.cols.agreements;
    const vRows = data.vehicles?.rows ?? [];
    const aRows = data.agreements?.rows ?? [];
    return { vc, ac, vRows, aRows };
  }, [data]);

  if (!data || !derived) return <CarLoaderCard height="h-96" label="Reading the courtesy cars sheet…" />;
  if (data.error) return <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{data.error}</p>;
  const { vc, ac, vRows, aRows } = derived;
  const branchOfV = (i: number) => data.vehicleBranch[i] ?? (vc.branch >= 0 ? vRows[i][vc.branch] || "No branch" : "All");
  const branchOfA = (i: number) => data.agreementBranch[i] ?? (ac.branch >= 0 ? aRows[i][ac.branch] || "No branch" : "All");
  const statusOfV = (i: number) => (vc.status >= 0 ? vRows[i][vc.status] || "Not set" : "Not set");

  // Vehicles
  const vIdx = vRows.map((_, i) => i).filter((i) => (branch === "all" || branchOfV(i) === branch) && (status === "all" || statusOfV(i) === status));
  // Agreements
  const aIdx = aRows.map((_, i) => i).filter((i) => (branch === "all" || branchOfA(i) === branch) && (!openOnly || data.open[i]));
  const openIdx = aRows.map((_, i) => i).filter((i) => data.open[i] && (branch === "all" || branchOfA(i) === branch));
  const daysOut = (i: number) => (ac.out >= 0 && aRows[i][ac.out] ? days(aRows[i][ac.out], data.open[i] ? data.today : aRows[i][ac.back] || data.today) : null);
  const openDays = openIdx.map(daysOut).filter((d): d is number => d != null);
  const avgOpen = openDays.length ? openDays.reduce((s, d) => s + d, 0) / openDays.length : null;
  const over14 = openDays.filter((d) => d > 14).length;
  const branches = [...new Set([...vRows.map((_, i) => branchOfV(i)), ...aRows.map((_, i) => branchOfA(i))])].filter((b) => b !== "All").sort();
  const sel = "rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-[13px]";
  const found = (label: string, i: number, headers: string[] | undefined) => `${label}: ${i >= 0 && headers ? headers[i] : "not found"}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1d1d1f]">Courtesy Cars</h1>
          <p className="mt-0.5 text-[14px] text-[#6e6e73]">{data.scope === "all" ? "All branches" : data.scope} · replacement vehicles and their agreements, from the courtesy cars sheet (refreshed every 10 minutes).</p>
        </div>
        <div className="inline-flex rounded-xl bg-[#f5f5f7] p-1 text-sm font-semibold ring-1 ring-black/[0.05]" role="tablist">
          {(
            [
              ["agreements", "Agreements"],
              ["vehicles", "Vehicles"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-lg px-4 py-1.5 ${tab === k ? "bg-white text-[#1d1d1f] shadow-sm" : "text-[#6e6e73]"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Vehicles" value={fmtInt(vRows.filter((_, i) => branch === "all" || branchOfV(i) === branch).length)} sub={vc.status >= 0 ? `${fmtInt(vRows.filter((_, i) => (branch === "all" || branchOfV(i) === branch) && /availab|free|ready/i.test(statusOfV(i))).length)} available` : undefined} />
        <Kpi label="With customers" value={fmtInt(openIdx.length)} sub="open agreements" tone={openIdx.length ? undefined : "good"} />
        <Kpi label="Average days out" value={avgOpen == null ? "—" : fmtNum(avgOpen, 1)} sub="open agreements" />
        <Kpi label="Out over 14 days" value={fmtInt(over14)} tone={over14 ? "bad" : "good"} />
        <Kpi label="Agreements" value={fmtInt(aRows.filter((_, i) => branch === "all" || branchOfA(i) === branch).length)} sub="in the sheet" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {data.scope === "all" && branches.length > 0 && (
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className={sel} aria-label="Branch">
            <option value="all">All branches</option>
            {branches.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        )}
        {tab === "agreements" ? (
          <label className="inline-flex items-center gap-2 text-[13px] text-[#3a3a3c]">
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Open agreements only
          </label>
        ) : (
          status !== "all" && (
            <button type="button" onClick={() => setStatus("all")} className="text-[13px] font-medium text-[#c4121a]">
              Clear status filter
            </button>
          )
        )}
      </div>

      {tab === "vehicles" ? (
        data.vehicles ? (
          <>
            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title="Vehicle status" subtitle="Click a status to filter the list">
                <Bars items={countBy(vRows.map((_, i) => i).filter((i) => branch === "all" || branchOfV(i) === branch).map(statusOfV))} active={status} onPick={(v) => setStatus(status === v ? "all" : v)} />
              </Panel>
              {data.scope === "all" && (
                <Panel title="Vehicles per branch">
                  <Bars items={countBy(vRows.map((_, i) => branchOfV(i)))} active={branch} onPick={(v) => setBranch(branch === v ? "all" : v)} />
                </Panel>
              )}
            </div>
            <SheetTableView
              title={data.vehicles.title}
              headers={data.vehicles.headers}
              rows={vIdx.map((i) => vRows[i])}
              copyCols={[vc.plate, vc.vin].filter((x) => x >= 0)}
              fileName="Courtesy cars - vehicles"
            />
          </>
        ) : (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">The sheet has no tab with &quot;vehicle&quot; in its name.</p>
        )
      ) : data.agreements ? (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Open agreements per branch" subtitle="Cars with customers now">
              <Bars items={countBy(aRows.map((_, i) => i).filter((i) => data.open[i]).map(branchOfA))} active={branch} onPick={data.scope === "all" ? (v) => setBranch(branch === v ? "all" : v) : undefined} />
            </Panel>
            <Panel title="Days out (open agreements)">
              <Bars
                items={(
                  [
                    ["0–3 days", 0, 3],
                    ["4–7 days", 4, 7],
                    ["8–14 days", 8, 14],
                    ["15–30 days", 15, 30],
                    ["Over 30 days", 31, Infinity],
                  ] as const
                ).map(([l, lo, hi]) => [l, openDays.filter((d) => d >= lo && d <= hi).length] as [string, number])}
              />
            </Panel>
          </div>
          <SheetTableView
            title={data.agreements.title}
            headers={data.agreements.headers}
            rows={aIdx.map((i) => aRows[i])}
            copyCols={[ac.wip, ac.plate, ac.agreement].filter((x) => x >= 0)}
            fileName="Courtesy cars - agreements"
            extra={[
              { header: "State", value: (k) => (data.open[aIdx[k]] ? <span className="rounded-full bg-[#c4121a]/10 px-2 py-0.5 text-[11px] font-semibold text-[#b10012]">With customer</span> : <span className="text-[#8e8e93]">Closed</span>), text: (k) => (data.open[aIdx[k]] ? "With customer" : "Closed") },
              { header: "Days", value: (k) => <span className="tabular-nums">{daysOut(aIdx[k]) ?? "—"}</span>, text: (k) => String(daysOut(aIdx[k]) ?? "") },
            ]}
          />
        </>
      ) : (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">The sheet has no tab with &quot;agreement&quot; in its name.</p>
      )}

      <p className="text-[12px] text-[#6e6e73]">
        Columns used - vehicles: {found("plate", vc.plate, data.vehicles?.headers)}, {found("status", vc.status, data.vehicles?.headers)}, {found("branch", vc.branch, data.vehicles?.headers)} · agreements: {found("WIP", ac.wip, data.agreements?.headers)}, {found("plate", ac.plate, data.agreements?.headers)}, {found("out date", ac.out, data.agreements?.headers)}, {found("return date", ac.back, data.agreements?.headers)}, {found("status", ac.status, data.agreements?.headers)}, {found("branch", ac.branch, data.agreements?.headers)}.
      </p>
    </div>
  );
}
