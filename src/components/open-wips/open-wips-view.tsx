"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getOpenWips, refreshOpenWips, saveWipNote, uploadOpenWips, type OpenWip, type OpenWipsData } from "@/app/actions/open-wips";
import { Panel, fmtDate, fmtInt, fmtNum } from "@/components/dashboard/ui";
import { downloadXlsx, type ExportColumn } from "@/components/dashboard/sections/invoicing-export";
import { Kpi } from "@/components/complaints/shared";
import { CarLoaderCard } from "@/components/spinner";
import { Glyph } from "@/components/ui/glyph";

const RED = "#c4121a";
const GREY = "#8e8e93";
const AGES = [
  { key: "0-7", label: "0–7 days", min: 0, max: 7 },
  { key: "8-15", label: "8–15 days", min: 8, max: 15 },
  { key: "16-30", label: "16–30 days", min: 16, max: 30 },
  { key: "31-60", label: "31–60 days", min: 31, max: 60 },
  { key: "61-90", label: "61–90 days", min: 61, max: 90 },
  { key: "90+", label: "Over 90 days", min: 91, max: Infinity },
];
const sar = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const ageOf = (w: OpenWip, today: string) => (w.received ? Math.max(0, Math.round((Date.parse(today) - Date.parse(w.received)) / 86_400_000)) : null);
const bucketOf = (age: number | null) => (age == null ? null : AGES.find((a) => age >= a.min && age <= a.max)?.key ?? null);

function group<T>(list: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of list) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}

/** Horizontal bars: count with the invoiceable value; click to filter. */
function Bars({ items, active, onPick }: { items: { label: string; count: number; value: number }[]; active?: string; onPick?: (label: string) => void }) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div className="space-y-2">
      {items.map((i) => (
        <button key={i.label} type="button" onClick={() => onPick?.(i.label)} className={`block w-full space-y-1 rounded-md text-left ${onPick ? "hover:bg-neutral-900/[0.03]" : "cursor-default"} ${active === i.label ? "bg-[#c4121a]/[0.06]" : ""}`}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="truncate font-medium text-[#1d1d1f]">{i.label}</span>
            <span className="shrink-0 tabular-nums text-[#6e6e73]">
              <span className="font-semibold text-[#1d1d1f]">{fmtInt(i.count)}</span> · SAR {sar(i.value)}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-neutral-900/[0.05]">
            <div className="h-full rounded-full" style={{ width: `${(i.count / max) * 100}%`, backgroundColor: active === i.label ? RED : "#3a3a3c" }} />
          </div>
        </button>
      ))}
    </div>
  );
}

/** The daily open-WIP count as a line. */
function DailyLine({ points }: { points: { day: string; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <p className="py-10 text-center text-sm text-[#6e6e73]">The line starts once there are two days of counts.</p>;
  const W = 760;
  const H = 220;
  const pad = { l: 40, r: 12, t: 14, b: 26 };
  const max = Math.max(...points.map((p) => p.count), 1) * 1.1;
  const min = Math.min(...points.map((p) => p.count)) * 0.9;
  const x = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / Math.max(1, max - min)) * (H - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.count).toFixed(1)}`).join("");
  const ticks = [0, 0.5, 1].map((t) => Math.round(min + t * (max - min)));
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  const h = hover == null ? null : points[hover];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--chart-grid, #e5e5ea)" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={GREY}>
              {t}
            </text>
          </g>
        ))}
        <path d={`${path}L${x(points.length - 1)},${H - pad.b}L${x(0)},${H - pad.b}Z`} fill={RED} opacity="0.07" />
        <path d={path} fill="none" stroke={RED} strokeWidth="2" />
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={p.day} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill={GREY}>
              {p.day.slice(8)}/{p.day.slice(5, 7)}
            </text>
          ) : null
        )}
        {points.map((p, i) => (
          <rect key={p.day} x={x(i) - (W - pad.l - pad.r) / points.length / 2} y={pad.t} width={(W - pad.l - pad.r) / points.length} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        {h && hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke={GREY} strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(h.count)} r="4" fill={RED} />
          </g>
        )}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-1 right-2 rounded-lg bg-neutral-900 px-2.5 py-1.5 text-[12px] text-white">
          {fmtDate(h.day)} · <b>{fmtInt(h.count)}</b> open
        </div>
      )}
    </div>
  );
}

function NoteCell({ w, canEdit, onSaved }: { w: OpenWip; canEdit: boolean; onSaved: (note: OpenWip["note"]) => void }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(w.note?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!edit)
    return (
      <div className="max-w-[16rem]">
        {w.note ? <div className="text-[12px] whitespace-pre-wrap text-[#1d1d1f]">{w.note.text}</div> : null}
        {w.note?.by && <div className="text-[10px] text-[#8e8e93]">{w.note.by} · {fmtDate(w.note.at)}</div>}
        {canEdit && (
          <button type="button" onClick={() => setEdit(true)} className="text-[12px] font-medium text-[#c4121a] hover:underline">
            {w.note ? "Edit" : "Add note"}
          </button>
        )}
      </div>
    );
  return (
    <div className="w-60 space-y-1">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus className="w-full rounded-lg border border-neutral-300 bg-white px-2 py-1 text-[12px]" />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await saveWipNote(w.key, text);
            setBusy(false);
            if (r.error) return setErr(r.error);
            onSaved(text.trim() ? { text: text.trim(), by: r.by ?? null, at: r.at ?? new Date().toISOString() } : null);
            setEdit(false);
          }}
          className="rounded-md bg-neutral-900 px-2.5 py-1 text-[12px] font-semibold text-white disabled:opacity-50"
        >
          Save
        </button>
        <button type="button" onClick={() => setEdit(false)} className="text-[12px] text-neutral-500">
          Cancel
        </button>
      </div>
      {err && <p className="text-[11px] text-red-700">{err}</p>}
    </div>
  );
}

type Filters = { branch: string; operator: string; status: string; saleType: string; inOut: string; age: string; q: string };
const NO_FILTERS: Filters = { branch: "all", operator: "all", status: "all", saleType: "all", inOut: "all", age: "all", q: "" };

/** Open WIPs: the open-WIP report (Autoline), counted per advisor, status, age and type, with notes and export. */
export function OpenWipsView() {
  const [data, setData] = useState<OpenWipsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [days, setDays] = useState(30);
  const [limit, setLimit] = useState(50);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    getOpenWips()
      .then(setData)
      .catch(() => setError("Could not load the open WIPs."));
  }, []);
  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  const set = (patch: Partial<Filters>) => {
    setF((cur) => ({ ...cur, ...patch }));
    setLimit(50);
  };
  const toggle = (k: keyof Filters, v: string) => set({ [k]: f[k] === v ? "all" : v });

  const all = useMemo(() => data?.wips ?? [], [data]);
  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  const list = useMemo(() => {
    const q = f.q.trim().toUpperCase();
    return all.filter(
      (w) =>
        (f.branch === "all" || w.branch === f.branch) &&
        (f.operator === "all" || w.operator === f.operator) &&
        (f.status === "all" || w.status === f.status) &&
        (f.saleType === "all" || w.saleType === f.saleType) &&
        (f.inOut === "all" || w.inOut === f.inOut) &&
        (f.age === "all" || AGES.find((a) => a.label === f.age)?.key === bucketOf(ageOf(w, today))) &&
        (!q || [w.wip, w.vin, w.registration, w.model, w.operator, w.orderRef, w.note?.text, ...w.autolineNotes].some((x) => (x ?? "").toUpperCase().includes(q)))
    );
  }, [all, f, today]);

  if (error) return <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!data) return <CarLoaderCard height="h-96" label="Loading open WIPs…" />;

  const branches = [...new Set(all.map((w) => w.branch))].sort();
  const sum = (l: OpenWip[], k: "invoiceable" | "labour" | "parts") => l.reduce((s, w) => s + w[k], 0);
  const ages = list.map((w) => ageOf(w, today)).filter((a): a is number => a != null);
  const avgAge = ages.length ? ages.reduce((s, a) => s + a, 0) / ages.length : null;
  const over30 = ages.filter((a) => a > 30).length;
  const ins = list.filter((w) => w.inOut === "IN").length;
  const outs = list.filter((w) => w.inOut === "OUT").length;

  // Daily count for the same branch / advisor filter.
  const dayMap = new Map<string, number>();
  for (const d of data.daily) if ((f.branch === "all" || d.branch === f.branch) && (f.operator === "all" || d.operator === f.operator)) dayMap.set(d.day, (dayMap.get(d.day) ?? 0) + d.count);
  const allPoints = [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, count]) => ({ day, count }));
  const points = days ? allPoints.filter((p) => Date.parse(p.day) >= Date.parse(today) - days * 86_400_000) : allPoints;
  const yesterday = allPoints.filter((p) => p.day < today).at(-1);

  const byOperator = [...group(list, (w) => `${w.operator}|${w.branch}`).entries()]
    .map(([k, l]) => {
      const a = l.map((w) => ageOf(w, today)).filter((x): x is number => x != null);
      return { op: k.split("|")[0], branch: k.split("|")[1], count: l.length, in: l.filter((w) => w.inOut === "IN").length, out: l.filter((w) => w.inOut === "OUT").length, avg: a.length ? a.reduce((s, x) => s + x, 0) / a.length : null, over30: a.filter((x) => x > 30).length, inv: sum(l, "invoiceable"), lab: sum(l, "labour"), par: sum(l, "parts") };
    })
    .sort((a, b) => b.count - a.count);
  const bars = (key: (w: OpenWip) => string) =>
    [...group(list, key).entries()].map(([label, l]) => ({ label, count: l.length, value: sum(l, "invoiceable") })).sort((a, b) => b.count - a.count);
  const ageBars = AGES.map((a) => {
    const l = list.filter((w) => bucketOf(ageOf(w, today)) === a.key);
    return { label: a.label, count: l.length, value: sum(l, "invoiceable") };
  });
  const byBranch = [...group(list, (w) => w.branch).entries()].map(([b, l]) => ({ b, l })).sort((a, b) => b.l.length - a.l.length);

  async function refresh() {
    setBusy("Reading the Google Sheet…");
    setMsg(null);
    const r = await refreshOpenWips();
    setBusy(null);
    if ("error" in r) return setMsg({ ok: false, text: r.error });
    setMsg({ ok: true, text: `${fmtInt(r.rows)} open WIPs · ${fmtInt(r.opened)} new · ${fmtInt(r.closed)} closed since the last import${r.history ? ` · ${fmtInt(r.history)} history rows` : ""}.` });
    load();
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(`Reading ${file.name}…`);
    setMsg(null);
    const fd = new FormData();
    fd.set("file", file);
    const r = await uploadOpenWips(fd);
    setBusy(null);
    if ("error" in r) return setMsg({ ok: false, text: r.error });
    setMsg({ ok: true, text: `${fmtInt(r.rows)} open WIPs · ${fmtInt(r.opened)} new · ${fmtInt(r.closed)} closed since the last import.` });
    load();
  }

  const exportCols: ExportColumn<OpenWip>[] = [
    { header: "Branch", value: (w) => w.branch },
    { header: "WIP", value: (w) => w.wip },
    { header: "Dept", value: (w) => w.dept },
    { header: "Advisor", value: (w) => w.operator, width: 22 },
    { header: "WIP status", value: (w) => w.status, width: 28 },
    { header: "Parts status", value: (w) => w.partsStatus },
    { header: "Type", value: (w) => w.saleType },
    { header: "In/Out", value: (w) => w.inOut },
    { header: "Received", value: (w) => w.received },
    { header: "Due out", value: (w) => w.dueOut },
    { header: "Age (days)", value: (w) => ageOf(w, today) },
    { header: "Invoiceable (SAR)", value: (w) => w.invoiceable, money: true },
    { header: "WIP labour (SAR)", value: (w) => w.labour, money: true },
    { header: "WIP parts (SAR)", value: (w) => w.parts, money: true },
    { header: "Account", value: (w) => w.account },
    { header: "VIN", value: (w) => w.vin, width: 20 },
    { header: "Registration", value: (w) => w.registration },
    { header: "Model", value: (w) => w.model, width: 26 },
    { header: "Order ref", value: (w) => w.orderRef },
    { header: "Autoline notes", value: (w) => w.autolineNotes.join(" | "), width: 40 },
    { header: "Note", value: (w) => w.note?.text ?? "", width: 30 },
    { header: "Note by", value: (w) => w.note?.by ?? "" },
  ];
  const sel = "rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-[13px]";
  const active = Object.entries(f).filter(([k, v]) => k !== "q" && v !== "all").length + (f.q ? 1 : 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1d1d1f]">Open WIPs</h1>
          <p className="mt-0.5 text-[14px] text-[#6e6e73]">
            {data.scope === "all" ? "All branches" : data.scope} · open work in progress from Autoline - an invoiced WIP leaves the report.
            {data.lastImport ? ` Updated ${fmtDate(data.lastImport.at)} ${new Date(data.lastImport.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" })} (${data.lastImport.source === "upload" ? "uploaded file" : "Google Sheet"}).` : " Not imported yet."}
          </p>
        </div>
        {data.canImport && (
          <div className="flex flex-wrap items-center gap-2">
            {busy && <span className="text-[12px] text-[#6e6e73]">{busy}</span>}
            <button type="button" disabled={!!busy} onClick={() => void refresh()} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-[13px] font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 disabled:opacity-50">
              <Glyph name="sheet" /> Refresh from sheet
            </button>
            <input ref={fileInput} type="file" accept=".xlsx,.csv" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
            <button type="button" disabled={!!busy} onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-[13px] font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 disabled:opacity-50">
              <Glyph name="upload" /> Upload file
            </button>
          </div>
        )}
      </div>
      {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}

      {!all.length ? (
        <p className="rounded-2xl bg-white px-5 py-10 text-center text-[14px] text-[#6e6e73] ring-1 ring-black/[0.05]">No open WIPs yet. {data.canImport ? 'Press "Refresh from sheet" or upload the report.' : "They appear after the report is imported."}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {data.scope === "all" && (
              <select value={f.branch} onChange={(e) => set({ branch: e.target.value, operator: "all" })} className={sel} aria-label="Branch">
                <option value="all">All branches</option>
                {branches.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            )}
            <select value={f.operator} onChange={(e) => set({ operator: e.target.value })} className={sel} aria-label="Advisor">
              <option value="all">All advisors</option>
              {[...new Set(all.filter((w) => f.branch === "all" || w.branch === f.branch).map((w) => w.operator))].sort().map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
            <select value={f.saleType} onChange={(e) => set({ saleType: e.target.value })} className={sel} aria-label="Type">
              <option value="all">All types</option>
              {[...new Set(all.map((w) => w.saleType))].sort().map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
            <select value={f.inOut} onChange={(e) => set({ inOut: e.target.value })} className={sel} aria-label="In or out">
              <option value="all">In and out</option>
              <option value="IN">Car in</option>
              <option value="OUT">Car out</option>
            </select>
            <input value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search WIP, VIN, plate, note" className={`${sel} w-56`} />
            {active > 0 && (
              <button type="button" onClick={() => set(NO_FILTERS)} className="text-[13px] font-medium text-[#c4121a]">
                Clear filters
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Kpi label="Open WIPs" value={fmtInt(list.length)} sub={yesterday && !active ? `${list.length - yesterday.count >= 0 ? "+" : "−"}${fmtInt(Math.abs(list.length - yesterday.count))} vs ${fmtDate(yesterday.day)}` : undefined} />
            <Kpi label="Invoiceable" value={`SAR ${sar(sum(list, "invoiceable"))}`} />
            <Kpi label="WIP labour" value={`SAR ${sar(sum(list, "labour"))}`} />
            <Kpi label="WIP parts" value={`SAR ${sar(sum(list, "parts"))}`} />
            <Kpi label="Average age" value={avgAge == null ? "—" : `${fmtNum(avgAge, 0)} days`} sub="since received" />
            <Kpi label="Over 30 days" value={fmtInt(over30)} tone={over30 ? "bad" : "good"} sub={list.length ? `${((over30 / list.length) * 100).toFixed(0)}% of open` : undefined} />
            <Kpi label="Car in / out" value={`${fmtInt(ins)} / ${fmtInt(outs)}`} sub="in the workshop / released" />
          </div>

          <Panel
            title="Open WIPs per day"
            subtitle={`${f.branch === "all" ? "All branches" : f.branch}${f.operator === "all" ? "" : ` · ${f.operator}`} - counted at each import`}
            action={
              <div className="inline-flex rounded-lg bg-neutral-900/[0.05] p-0.5 text-[12px] font-medium">
                {[
                  [30, "30 days"],
                  [90, "90 days"],
                  [0, "All"],
                ].map(([d, l]) => (
                  <button key={d} type="button" onClick={() => setDays(Number(d))} className={`rounded-md px-2.5 py-1 ${days === d ? "bg-white shadow-sm" : "text-neutral-600"}`}>
                    {l}
                  </button>
                ))}
              </div>
            }
          >
            <DailyLine points={points} />
          </Panel>

          <Panel title="Per advisor" subtitle="Click a row to show only that advisor">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-[13px] tabular-nums">
                <thead className="border-b border-neutral-200 text-left text-[12px] text-[#6e6e73]">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Advisor</th>
                    <th className="px-3 py-2 font-medium">Open</th>
                    <th className="px-3 py-2 text-right font-medium">In / Out</th>
                    <th className="px-3 py-2 text-right font-medium">Avg. age</th>
                    <th className="px-3 py-2 text-right font-medium">Over 30 d</th>
                    <th className="px-3 py-2 text-right font-medium">Invoiceable</th>
                    <th className="px-3 py-2 text-right font-medium">Labour</th>
                    <th className="py-2 pl-3 text-right font-medium">Parts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {byOperator.map((o) => (
                    <tr key={`${o.op}|${o.branch}`} onClick={() => toggle("operator", o.op)} className={`cursor-pointer hover:bg-neutral-900/[0.03] ${f.operator === o.op ? "bg-[#c4121a]/[0.06]" : ""}`}>
                      <td className="py-2 pr-3">
                        <div className="font-semibold text-[#1d1d1f]">{o.op}</div>
                        {data.scope === "all" && <div className="text-[11px] text-[#8e8e93]">{o.branch}</div>}
                      </td>
                      <td className="w-48 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="w-8 font-semibold">{o.count}</span>
                          <div className="h-1.5 flex-1 rounded-full bg-neutral-900/[0.05]">
                            <div className="h-full rounded-full bg-[#3a3a3c]" style={{ width: `${(o.count / (byOperator[0]?.count || 1)) * 100}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-[#3a3a3c]">
                        {o.in} / {o.out}
                      </td>
                      <td className="px-3 py-2 text-right">{o.avg == null ? "—" : `${fmtNum(o.avg, 0)} d`}</td>
                      <td className={`px-3 py-2 text-right ${o.over30 ? "font-semibold text-[#d70015]" : "text-[#8e8e93]"}`}>{o.over30}</td>
                      <td className="px-3 py-2 text-right font-semibold">{sar(o.inv)}</td>
                      <td className="px-3 py-2 text-right">{sar(o.lab)}</td>
                      <td className="py-2 pl-3 text-right">{sar(o.par)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="WIP status" subtitle="Count · invoiceable (SAR). Click to filter.">
              <Bars items={bars((w) => w.status)} active={f.status} onPick={(v) => toggle("status", v)} />
            </Panel>
            <Panel title="WIP aging" subtitle="Days since the car was received. Click to filter.">
              <Bars items={ageBars} active={f.age} onPick={(v) => toggle("age", v)} />
            </Panel>
            <Panel title="Type" subtitle="Retail, insurance, warranty, internal…">
              <Bars items={bars((w) => w.saleType)} active={f.saleType} onPick={(v) => toggle("saleType", v)} />
            </Panel>
            <Panel title="Parts status">
              <Bars items={bars((w) => w.partsStatus ?? "Not set")} />
            </Panel>
          </div>

          {data.scope === "all" && f.branch === "all" && (
            <Panel title="Per branch" subtitle="Click a branch to show only it">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-[13px] tabular-nums">
                  <thead className="border-b border-neutral-200 text-left text-[12px] text-[#6e6e73]">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Branch</th>
                      <th className="px-3 py-2 text-right font-medium">Open</th>
                      <th className="px-3 py-2 text-right font-medium">In / Out</th>
                      <th className="px-3 py-2 text-right font-medium">Avg. age</th>
                      <th className="px-3 py-2 text-right font-medium">Over 30 d</th>
                      <th className="py-2 pl-3 text-right font-medium">Invoiceable</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {byBranch.map(({ b, l }) => {
                      const a = l.map((w) => ageOf(w, today)).filter((x): x is number => x != null);
                      return (
                        <tr key={b} onClick={() => set({ branch: b, operator: "all" })} className="cursor-pointer hover:bg-neutral-900/[0.03]">
                          <td className="py-2 pr-3 font-semibold text-[#1d1d1f]">{b}</td>
                          <td className="px-3 py-2 text-right font-semibold">{l.length}</td>
                          <td className="px-3 py-2 text-right">
                            {l.filter((w) => w.inOut === "IN").length} / {l.filter((w) => w.inOut === "OUT").length}
                          </td>
                          <td className="px-3 py-2 text-right">{a.length ? `${fmtNum(a.reduce((s, x) => s + x, 0) / a.length, 0)} d` : "—"}</td>
                          <td className="px-3 py-2 text-right text-[#d70015]">{a.filter((x) => x > 30).length}</td>
                          <td className="py-2 pl-3 text-right font-semibold">{sar(sum(l, "invoiceable"))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          <Panel
            title={`WIPs (${fmtInt(list.length)})`}
            subtitle="Oldest first. Autoline notes are from the report; your note stays on the WIP across imports."
            action={
              <button
                type="button"
                disabled={!list.length}
                onClick={() => void downloadXlsx(`Open WIPs ${today}.xlsx`, "Open WIPs", exportCols, list)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-[13px] font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 disabled:opacity-40"
              >
                <Glyph name="download" /> Export ({fmtInt(list.length)})
              </button>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] text-[12px]">
                <thead className="border-b border-neutral-200 text-left text-[11px] text-[#6e6e73]">
                  <tr>
                    {["WIP", "Advisor", "Status", "Type", "In/Out", "Received", "Age", "Invoiceable", "Labour", "Parts", "Car", "Autoline notes", "Note"].map((h) => (
                      <th key={h} className={`px-2 py-2 font-medium whitespace-nowrap ${["Invoiceable", "Labour", "Parts", "Age"].includes(h) ? "text-right" : ""}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {list.slice(0, limit).map((w) => {
                    const age = ageOf(w, today);
                    return (
                      <tr key={w.key} className="align-top">
                        <td className="px-2 py-2 whitespace-nowrap">
                          <div className="font-mono font-semibold text-[#1d1d1f] select-all">{w.wip}</div>
                          {data.scope === "all" && <div className="text-[10px] text-[#8e8e93]">{w.branch}</div>}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">{w.operator}</td>
                        <td className="px-2 py-2">
                          <div>{w.status}</div>
                          {w.partsStatus && <div className="text-[10px] text-[#8e8e93]">Parts: {w.partsStatus}</div>}
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">{w.saleType}</td>
                        <td className="px-2 py-2">{w.inOut}</td>
                        <td className="px-2 py-2 whitespace-nowrap">{fmtDate(w.received)}</td>
                        <td className={`px-2 py-2 text-right tabular-nums ${age != null && age > 30 ? "font-semibold text-[#d70015]" : ""}`}>{age ?? "—"}</td>
                        <td className="px-2 py-2 text-right font-semibold tabular-nums">{sar(w.invoiceable)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{sar(w.labour)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{sar(w.parts)}</td>
                        <td className="px-2 py-2">
                          <div className="whitespace-nowrap">{w.model}</div>
                          <div className="font-mono text-[10px] text-[#8e8e93]">
                            {w.registration} {w.vin}
                          </div>
                        </td>
                        <td className="max-w-[16rem] px-2 py-2 text-[11px] text-[#3a3a3c]">
                          {w.autolineNotes.map((n, i) => (
                            <div key={i} className="truncate" title={n}>
                              {n}
                            </div>
                          ))}
                        </td>
                        <td className="px-2 py-2">
                          <NoteCell w={w} canEdit={data.canEdit} onSaved={(note) => setData((d) => (d ? { ...d, wips: d.wips.map((x) => (x.key === w.key ? { ...x, note } : x)) } : d))} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {list.length > limit && (
              <div className="mt-3 text-center">
                <button type="button" onClick={() => setLimit((l) => l + 100)} className="rounded-lg bg-neutral-900/[0.06] px-4 py-1.5 text-[13px] font-medium hover:bg-neutral-900/[0.1]">
                  Show more ({fmtInt(list.length - limit)} left)
                </button>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
