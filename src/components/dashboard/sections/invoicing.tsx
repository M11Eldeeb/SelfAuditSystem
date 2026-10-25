"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  getInvoicingCounts,
  getInvoicingData,
  getInvoicingExport,
  getInvoicingMonthly,
  refreshInvoicing,
  type InvoicingData,
  type InvoicingFilter,
  type InvoicingLine,
} from "@/app/admin/dashboard/invoicing-actions";
import { Donut } from "@/components/dashboard/charts";
import { TipCard, useHoverCard } from "@/components/dashboard/hover";
import { Card, Label, Panel, Pill, fmtInt } from "@/components/dashboard/ui";
import { RiyalIcon, Sar } from "@/components/dashboard/riyal";
import { InvoicingDrill, type Drill } from "./invoicing-drill";
import { INV, INV_SERIES, MoneyLine } from "./invoicing-charts";
import { downloadXlsx, LINE_COLUMNS } from "./invoicing-export";
import { UnclaimedWarranty } from "./invoicing-unclaimed";
import { Glyph } from "@/components/ui/glyph";

/** Fixed peg. */
const SAR_PER_USD = 3.75;
const usd = (sar: number, digits = 0) => `$${(sar / SAR_PER_USD).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const sar0 = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
/** The data is refreshed by the page itself when the newest import is older than this. */
const STALE_MS = 3 * 3600_000;
/** The parts business lines (the report's Department8 formula): branch R7 or a wholesale / affiliate account = Wholesale / Affiliates, sale type P = Parts Counter. */
const PARTS_BUSINESS = ["Workshop Parts", "Lubes", "Parts Counter", "Wholesale", "Affiliates"] as const;

const CONNECT_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "The report mailbox is connected - reading the newest report..." },
  cancelled: { ok: false, text: "The Google sign-in was cancelled, so nothing was connected." },
  "bad-state": { ok: false, text: "That sign-in could not be verified. Please connect again." },
  "no-refresh-token": { ok: false, text: "Google did not give a lasting connection. Remove the app's access in that Google account's settings, then connect again." },
  "wrong-account": { ok: false, text: "That is not a company (@jiadmotors.com) mailbox." },
  "no-read-permission": { ok: false, text: "The permission to read e-mail was not ticked on Google's screen. Connect again and keep every box ticked." },
  "not-configured": { ok: false, text: "Google sign-in is not set up on the server." },
  failed: { ok: false, text: "Connecting failed. Please try again." },
};

const stamp = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Riyadh" }) : "—";
const monthLabel = (m: string) => new Date(`${m}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const monthShort = (m: string) => new Date(`${m}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
const dayLong = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

type Filters = { type: string; account: string; branch: string; operator: string };
const ALL = "";
const DEFAULT_FILTERS: Filters = { type: "Warranty", account: ALL, branch: ALL, operator: ALL };

type Agg = { key: string; label: string; sub?: string; labor: number; parts: number; lines: number };
function groupBy(lines: InvoicingLine[], key: (l: InvoicingLine) => string, label: (l: InvoicingLine) => string, sub?: (l: InvoicingLine) => string): Agg[] {
  const m = new Map<string, Agg>();
  for (const l of lines) {
    const k = key(l);
    const g = m.get(k) ?? { key: k, label: label(l), sub: sub?.(l), labor: 0, parts: 0, lines: 0 };
    if (l.s === "labor") g.labor += l.a;
    else g.parts += l.a;
    g.lines += l.n;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.labor + b.parts - (a.labor + a.parts));
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <Label>{label}</Label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 min-w-0 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 focus:border-red-700 focus:ring-2 focus:ring-red-700/15 focus:outline-none">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Breakdown({ title, rows, onPick, onOpen, active, bind }: { title: string; rows: Agg[]; onPick: (k: string) => void; onOpen: (r: Agg) => void; active: string; bind: ReturnType<typeof useHoverCard>["bind"] }) {
  const [q, setQ] = useState("");
  const shown = q ? rows.filter((r) => `${r.label} ${r.sub ?? ""}`.toLowerCase().includes(q.toLowerCase())) : rows;
  const max = Math.max(...rows.map((r) => r.labor + r.parts), 1);
  return (
    <Panel title={title} className="min-w-0" action={rows.length > 8 ? <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-7 w-28 rounded-md border border-slate-300 px-2 text-xs" /> : undefined}>
      <div className="max-h-96 space-y-1 overflow-y-auto pr-1">
        {shown.map((r) => {
          const total = r.labor + r.parts;
          return (
            <div key={r.key} className={`flex items-center gap-1 rounded-lg transition-colors ${active === r.key ? "bg-red-50 ring-1 ring-red-700/30" : "hover:bg-slate-50"}`}>
              <button
                type="button"
                onClick={() => onOpen(r)}
                className="block min-w-0 flex-1 px-2 py-1.5 text-left"
                {...bind(
                  <TipCard
                    title={r.label}
                    rows={[
                      { label: "Labor", value: `SAR ${sar0(r.labor)}`, color: INV.labor },
                      { label: "Parts", value: `SAR ${sar0(r.parts)}`, color: INV.parts },
                      { label: "Total", value: `SAR ${sar0(total)} · ${usd(total)}`, strong: true },
                      { label: "Lines", value: fmtInt(r.lines) },
                    ]}
                    note={`${r.sub ? `${r.sub} · ` : ""}Click to see the lines`}
                  />
                )}
              >
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate font-medium text-slate-900">
                    {r.label}
                    {r.sub && <span className="ml-1 text-xs font-normal text-slate-500">{r.sub}</span>}
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-slate-900">
                    <Sar value={total} /> <span className="font-normal text-slate-500">· {usd(total)}</span>
                  </span>
                </div>
                <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div style={{ width: `${(r.labor / max) * 100}%`, backgroundColor: INV.labor }} />
                  <div style={{ width: `${(r.parts / max) * 100}%`, backgroundColor: INV.parts }} />
                </div>
              </button>
              <button
                type="button"
                onClick={() => onPick(active === r.key ? ALL : r.key)}
                title={active === r.key ? "Remove this filter" : "Filter the dashboard by this"}
                className={`shrink-0 rounded-md px-1.5 py-1 text-[11px] font-semibold ${active === r.key ? "text-red-800" : "text-slate-400 hover:text-red-800"}`}
              >
                <Glyph name={active === r.key ? "close" : "chevronDown"} size={14} />
              </button>
            </div>
          );
        })}
        {shown.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No lines for these filters.</p>}
      </div>
    </Panel>
  );
}

function Legend({ rows }: { rows: Agg[] }) {
  const total = rows.reduce((s, r) => s + r.labor + r.parts, 0) || 1;
  return (
    <ul className="mt-3 space-y-1 text-xs">
      {rows.map((r, i) => (
        <li key={r.key} className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: INV_SERIES[i % INV_SERIES.length] }} />
            <span className="truncate text-slate-900">{r.label}</span>
          </span>
          <span className="shrink-0 text-slate-500">
            <Sar value={r.labor + r.parts} /> · {(((r.labor + r.parts) / total) * 100).toFixed(1)}%
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A number card; clickable when it has lines behind it. */
function Kpi({ label, value, sub, accent, onClick, money = true }: { label: string; value: number | string; sub?: React.ReactNode; accent: string; onClick?: () => void; money?: boolean }) {
  const body = (
    <Card accent={accent} className={`h-full ${onClick ? "transition-shadow hover:shadow-md" : ""}`}>
      <Label>{label}</Label>
      <div className="mt-1 flex items-center gap-1.5 font-display text-[1.6rem] leading-tight font-bold tracking-tight text-slate-900 tabular-nums">
        {money && typeof value === "number" && <RiyalIcon className="h-[0.8em] w-[0.8em]" />}
        {typeof value === "number" ? (money ? sar0(value) : fmtInt(value)) : value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </Card>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="text-left" title="Click to see the lines">
      {body}
    </button>
  ) : (
    body
  );
}

/** Officer-only dashboard tab: labor (KH9) + parts (MG5) invoicing from the data analyst's daily report e-mail. */
export function InvoicingSection() {
  const params = useSearchParams();
  const flag = params.get("mail");
  const [data, setData] = useState<InvoicingData | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(flag ? (CONNECT_MESSAGES[flag] ?? null) : null);
  const [f, setF] = useState<Filters>(DEFAULT_FILTERS);
  const autoTried = useRef(false);
  const [drill, setDrill] = useState<(Drill & { apply?: () => void }) | null>(null);
  const [counts, setCounts] = useState<{ key: string; workOrders: number; lines: number } | null>(null);
  const [monthly, setMonthly] = useState<{ key: string; rows: Awaited<ReturnType<typeof getInvoicingMonthly>> } | null>(null);
  const { bind, layer } = useHoverCard();

  const load = useCallback(async (m: string | null) => {
    setLoading(true);
    try {
      const d = await getInvoicingData(m);
      setData(d);
      setMonth(d.month);
    } catch {
      setNote({ ok: false, text: "Could not load the invoicing data - please try again." });
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(
    async (force = false) => {
      setRefreshing(true);
      setNote({ ok: true, text: "Looking for the newest report in Gmail..." });
      try {
        const r = await refreshInvoicing(force);
        const text =
          r.status === "imported"
            ? `Imported ${r.fileName} (received ${stamp(r.receivedAt)}): ${fmtInt(r.laborLines)} labor and ${fmtInt(r.partLines)} parts lines.`
            : r.status === "unchanged"
              ? `Already up to date - no newer report since ${stamp(r.receivedAt)}.`
              : r.status === "not-found"
                ? "No report e-mail with an Excel file was found in the last 40 days."
                : r.status === "not-connected"
                  ? "Connect the mailbox the report arrives in first."
                  : r.error;
        setNote({ ok: r.status === "imported" || r.status === "unchanged", text });
        if (r.status === "imported") await load(null);
      } catch {
        setNote({ ok: false, text: "Refreshing failed - please try again." });
      } finally {
        setRefreshing(false);
      }
    },
    [load]
  );

  useEffect(() => {
    queueMicrotask(() => void load(null));
  }, [load]);

  // Fresh data on open: read Gmail by itself when the newest import is old (or right after connecting).
  useEffect(() => {
    if (!data || autoTried.current || !data.connectedAs) return;
    const age = data.lastImport ? Date.now() - Date.parse(data.lastImport.importedAt) : Infinity;
    if (flag === "connected" || age > STALE_MS) {
      autoTried.current = true;
      queueMicrotask(() => void refresh());
    }
  }, [data, flag, refresh]);

  const lines = useMemo(() => data?.lines ?? [], [data]);
  const options = useMemo(() => {
    const uniq = (pick: (l: InvoicingLine) => [string, string]) => [...new Map(lines.map((l) => pick(l))).entries()].filter(([k]) => k).sort((a, b) => a[0].localeCompare(b[0]));
    return { types: [...new Set(lines.map((l) => l.t).filter(Boolean))].sort(), accounts: uniq((l) => [l.ac, l.an]), branches: uniq((l) => [l.b, l.bn]), operators: uniq((l) => [l.op, l.op]) };
  }, [lines]);

  const matchesOthers = useCallback((l: InvoicingLine) => (!f.account || l.ac === f.account) && (!f.branch || l.b === f.branch) && (!f.operator || l.op === f.operator), [f.account, f.branch, f.operator]);
  const filtered = useMemo(() => lines.filter((l) => (!f.type || l.t === f.type) && matchesOthers(l)), [lines, f.type, matchesOthers]);
  const totals = useMemo(() => {
    let labor = 0, parts = 0, laborLines = 0, partLines = 0;
    for (const l of filtered) {
      if (l.s === "labor") {
        labor += l.a;
        laborLines += l.n;
      } else {
        parts += l.a;
        partLines += l.n;
      }
    }
    return { labor, parts, total: labor + parts, laborLines, partLines };
  }, [filtered]);
  const byBranch = useMemo(() => groupBy(filtered, (l) => l.b, (l) => l.b, (l) => l.bn), [filtered]);
  const byOperator = useMemo(() => groupBy(filtered, (l) => l.op, (l) => l.op || "(none)"), [filtered]);
  const byAccount = useMemo(() => groupBy(filtered, (l) => l.ac, (l) => l.ac || "(none)", (l) => l.an), [filtered]);
  const byDay = useMemo(() => groupBy(filtered, (l) => l.d ?? "", (l) => l.d ?? "").filter((d) => d.key).sort((a, b) => a.key.localeCompare(b.key)), [filtered]);
  const byDept = useMemo(() => groupBy(filtered, (l) => l.dp || "(none)", (l) => l.dp || "(none)"), [filtered]);
  // Share by sales type ignores the sales type filter (otherwise it is always 100% warranty).
  const byType = useMemo(() => groupBy(lines.filter(matchesOthers), (l) => l.t || "(none)", (l) => l.t || "(none)"), [lines, matchesOthers]);
  // Parts business (all sales types): workshop parts, lubes, parts counter, wholesale, affiliates.
  const partsBiz = useMemo(() => {
    const g = new Map(groupBy(lines.filter((l) => l.s === "parts" && matchesOthers(l)), (l) => l.dp, (l) => l.dp).map((x) => [x.key, x]));
    return PARTS_BUSINESS.map((k) => ({ key: k, total: g.get(k)?.parts ?? 0, lines: g.get(k)?.lines ?? 0 }));
  }, [lines, matchesOthers]);

  const set = (k: keyof Filters) => (v: string) => setF((prev) => ({ ...prev, [k]: v }));
  const base: InvoicingFilter = { type: f.type, account: f.account, branch: f.branch, operator: f.operator };
  const branchName = options.branches.find(([c]) => c === f.branch)?.[1];
  const scope = [f.type || "All sales types", f.branch && `${f.branch}${branchName ? ` ${branchName}` : ""}`, f.account, f.operator].filter(Boolean).join(" · ");
  const open = (title: string, extra: InvoicingFilter, total?: number, apply?: () => void) => setDrill({ title: `${title} - ${scope}`, filter: { ...base, ...extra }, total, apply });

  // Invoiced work orders and month history, counted in the database for the current filters.
  const filterKey = `${f.type}|${f.account}|${f.branch}|${f.operator}`;
  const countKey = `${month}|${filterKey}`;
  useEffect(() => {
    if (!month) return;
    let alive = true;
    getInvoicingCounts(month, { type: f.type, account: f.account, branch: f.branch, operator: f.operator }).then((c) => alive && setCounts({ key: countKey, ...c }), () => {});
    return () => {
      alive = false;
    };
  }, [countKey, month, f.type, f.account, f.branch, f.operator]);
  useEffect(() => {
    let alive = true;
    getInvoicingMonthly({ type: f.type, account: f.account, branch: f.branch, operator: f.operator }).then((rows) => alive && setMonthly({ key: filterKey, rows }), () => {});
    return () => {
      alive = false;
    };
  }, [filterKey, f.type, f.account, f.branch, f.operator]);
  const history = useMemo(() => {
    const m = new Map<string, { labor: number; parts: number }>();
    for (const r of monthly?.rows ?? []) {
      const g = m.get(r.month) ?? { labor: 0, parts: 0 };
      if (r.source === "labor") g.labor += r.amount;
      else g.parts += r.amount;
      m.set(r.month, g);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [monthly]);

  async function exportView() {
    if (!month) return;
    setExporting(true);
    try {
      const rows = await getInvoicingExport(month, base);
      await downloadXlsx(`Invoicing ${month.slice(0, 7)} - ${scope}.xlsx`, "Lines", LINE_COLUMNS, rows);
    } catch {
      setNote({ ok: false, text: "The export failed - please try again." });
    } finally {
      setExporting(false);
    }
  }

  if (loading && !data) return <div className="h-80 animate-pulse rounded-xl bg-white ring-1 ring-slate-200" />;
  const chips = (
    [
      ["type", f.type !== DEFAULT_FILTERS.type ? `Sales type: ${f.type || "All"}` : ""],
      ["branch", f.branch && `Branch: ${f.branch}${branchName ? ` ${branchName}` : ""}`],
      ["account", f.account && `Account: ${f.account}`],
      ["operator", f.operator && `Operator: ${f.operator}`],
    ] as [keyof Filters, string][]
  ).filter(([, t]) => t);

  return (
    <div className="space-y-5">
      {layer}
      <Panel
        eyebrow="Warranty invoicing"
        title="Labor + parts invoiced"
        subtitle={
          data?.lastImport
            ? `Daily report e-mail${data.lastImport.receivedAt ? ` received ${stamp(data.lastImport.receivedAt)}` : ""} · ${data.lastImport.fileName ?? ""}`
            : "From the data analyst's daily \"Major Service Indicators\" report e-mail"
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {data?.connectedAs ? (
              <>
                <Pill tone="muted">Gmail: {data.connectedAs}</Pill>
                <button type="button" onClick={() => void refresh()} disabled={refreshing} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm disabled:opacity-60" style={{ backgroundColor: INV.labor }}>
                  {refreshing ? "Refreshing..." : "↻ Refresh"}
                </button>
                <a href="/api/google-mail/connect?purpose=invoicing" className="text-xs font-medium text-slate-500 underline">
                  Change mailbox
                </a>
              </>
            ) : (
              <a href="/api/google-mail/connect?purpose=invoicing" className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm" style={{ backgroundColor: INV.labor }}>
                Connect the report mailbox (read-only)
              </a>
            )}
            {month && (
              <button type="button" onClick={() => void exportView()} disabled={exporting} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60">
                {exporting ? "Exporting..." : "Export lines"}
              </button>
            )}
          </div>
        }
      >
        {note && <p className={`mb-3 rounded-lg px-3 py-2 text-sm ${note.ok ? "bg-red-50 text-red-900" : "bg-red-50 text-red-700"}`}>{note.text}</p>}
        {!data?.connectedAs && (
          <p className="mb-3 text-sm text-slate-500">
            Sign in with the Google mailbox the daily report arrives in. The portal can only read it - it searches for the e-mail whose subject contains &quot;Major Service Indicators Daily Report&quot; and
            takes its Excel file (KH9-Labor and MG5-Parts sheets).
          </p>
        )}
        {data && data.months.length > 0 && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Select label="Month" value={month ?? ""} onChange={(m) => void load(m)} options={data.months.map((m) => ({ value: m, label: monthLabel(m) }))} />
            <Select label="Sales type" value={f.type} onChange={set("type")} options={[{ value: ALL, label: "All" }, ...options.types.map((t) => ({ value: t, label: t }))]} />
            <Select label="Account code" value={f.account} onChange={set("account")} options={[{ value: ALL, label: "All accounts" }, ...options.accounts.map(([c, n]) => ({ value: c, label: `${c} - ${n}` }))]} />
            <Select label="Branch" value={f.branch} onChange={set("branch")} options={[{ value: ALL, label: "All branches" }, ...options.branches.map(([c, n]) => ({ value: c, label: n ? `${c} - ${n}` : c }))]} />
            <Select label="Owing operator" value={f.operator} onChange={set("operator")} options={[{ value: ALL, label: "All operators" }, ...options.operators.map(([o]) => ({ value: o, label: o }))]} />
          </div>
        )}
        {chips.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {chips.map(([k, t]) => (
              <button key={k} type="button" onClick={() => set(k)(DEFAULT_FILTERS[k])} className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-900 ring-1 ring-red-700/20 hover:bg-red-100">
                {t} <Glyph name="close" size={12} />
              </button>
            ))}
            <button type="button" onClick={() => setF(DEFAULT_FILTERS)} className="text-xs font-medium text-slate-500 underline">
              Reset all
            </button>
          </div>
        )}
      </Panel>

      {data && month && data.months.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Kpi label="Labor (KH9)" value={totals.labor} sub={`${usd(totals.labor)} · ${fmtInt(totals.laborLines)} lines`} accent={INV.labor} onClick={() => open("Labor", { source: "labor" }, totals.labor)} />
            <Kpi label="Parts (MG5)" value={totals.parts} sub={`${usd(totals.parts)} · ${fmtInt(totals.partLines)} lines`} accent={INV.parts} onClick={() => open("Parts", { source: "parts" }, totals.parts)} />
            <Kpi label="Total invoiced" value={totals.total} sub={`${usd(totals.total)} · ${monthLabel(month)}`} accent={INV.total} onClick={() => open("Total", {}, totals.total)} />
          </div>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Kpi label="Invoiced work orders" value={counts?.key === countKey ? counts.workOrders : "…"} money={false} sub="distinct WIPs" accent="#64748b" onClick={() => open("Invoiced work orders", {}, totals.total)} />
            <Kpi
              label="Avg per work order"
              value={counts?.key === countKey && counts.workOrders ? totals.total / counts.workOrders : "…"}
              sub={`OBS ${fmtInt(totals.laborLines + totals.partLines)} lines`}
              accent="#64748b"
            />
            <Kpi label="Parts to labor ratio" value={totals.labor ? (totals.parts / totals.labor).toFixed(2) : "—"} money={false} sub="SAR parts per 1 SAR labor" accent="#64748b" />
            <Kpi label="Average per day" value={byDay.length ? totals.total / byDay.length : 0} sub={`${usd(byDay.length ? totals.total / byDay.length : 0)} · ${byDay.length} invoicing days`} accent="#64748b" />
          </div>

          <UnclaimedWarranty month={month} branch={f.branch} />

          <Panel title="Daily sales" subtitle="Labor, parts and total per invoice day - hover for the amounts, click a day to see its lines">
            <MoneyLine
              labels={byDay.map((d) => ({ key: d.key, short: d.key.slice(8), long: dayLong(d.key) }))}
              series={[
                { name: "Total", color: INV.total, values: byDay.map((d) => d.labor + d.parts) },
                { name: "Labor", color: INV.labor, values: byDay.map((d) => d.labor) },
                { name: "Parts", color: INV.parts, values: byDay.map((d) => d.parts) },
              ]}
              onPick={(i) => open(`Invoiced on ${dayLong(byDay[i].key)}`, { day: byDay[i].key }, byDay[i].labor + byDay[i].parts)}
              pickHint="Click to see this day's lines"
            />
          </Panel>

          <Panel title="Parts business" subtitle="All sales types (the report's Department formula): Wholesale = branch R7 or a wholesale account on the parts counter, Parts Counter = counter sales, Affiliates = A0000200 / A0000085">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {partsBiz.map((p, i) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setDrill({ title: `${p.key} - ${[f.branch, f.account, f.operator].filter(Boolean).join(" · ") || "all branches"}`, filter: { account: f.account, branch: f.branch, operator: f.operator, source: "parts", department: p.key }, total: p.total })}
                  className="rounded-xl bg-white p-3 text-left ring-1 ring-slate-200 transition-shadow hover:shadow-md"
                  title="Click to see the lines"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: INV_SERIES[i] }} />
                    <Label>{p.key}</Label>
                  </div>
                  <div className="mt-1 font-display text-xl font-bold text-slate-900">
                    <Sar value={p.total} />
                  </div>
                  <div className="text-xs text-slate-500">
                    {usd(p.total)} · {fmtInt(p.lines)} lines
                  </div>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Monthly trend" subtitle="Every month imported so far (the analyst's file holds only the current month - the portal keeps the history). Click a month to open it.">
            <MoneyLine
              labels={history.map(([m]) => ({ key: m, short: monthShort(m), long: monthLabel(m) }))}
              series={[
                { name: "Total", color: INV.total, values: history.map(([, v]) => v.labor + v.parts) },
                { name: "Labor", color: INV.labor, values: history.map(([, v]) => v.labor) },
                { name: "Parts", color: INV.parts, values: history.map(([, v]) => v.parts) },
              ]}
              onPick={(i) => void load(history[i][0])}
              pickHint="Click to open this month"
            />
            {history.length === 1 && <p className="mt-1 text-xs text-slate-500">History starts with {monthLabel(history[0][0])} - each new month is added as the reports arrive.</p>}
          </Panel>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Panel title="Sales type" subtitle="Share of the amount - click a slice to see its lines">
              <Donut
                segments={byType.map((t, i) => ({ label: t.label, value: t.labor + t.parts, color: INV_SERIES[i % INV_SERIES.length] }))}
                center={`${byType.length}`}
                caption="sales types"
                onSelect={(label) => {
                  const t = byType.find((x) => x.label === label);
                  const type = label === "(none)" ? "" : label;
                  setDrill({ title: `Sales type ${label} - ${[f.branch, f.account, f.operator].filter(Boolean).join(" · ") || "all"}`, filter: { ...base, type }, total: t ? t.labor + t.parts : undefined, apply: () => set("type")(type) });
                }}
              />
              <Legend rows={byType} />
            </Panel>
            <Panel title="Department" subtitle="Labor / Consumables / Sublet and the parts departments - click a slice to see its lines">
              <Donut
                segments={byDept.map((t, i) => ({ label: t.label, value: t.labor + t.parts, color: INV_SERIES[i % INV_SERIES.length] }))}
                center={`${byDept.length}`}
                caption="departments"
                onSelect={(label) => {
                  const t = byDept.find((x) => x.label === label);
                  open(`Department ${label}`, { department: label === "(none)" ? "" : label }, t ? t.labor + t.parts : undefined);
                }}
              />
              <Legend rows={byDept} />
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Breakdown title="By branch" rows={byBranch} active={f.branch} onPick={set("branch")} onOpen={(r) => open(`Branch ${r.label}${r.sub ? ` ${r.sub}` : ""}`, { branch: r.key }, r.labor + r.parts, () => set("branch")(r.key))} bind={bind} />
            <Breakdown title="Top performance - owing operator" rows={byOperator} active={f.operator} onPick={set("operator")} onOpen={(r) => open(`Owing operator ${r.label}`, { operator: r.key }, r.labor + r.parts, () => set("operator")(r.key))} bind={bind} />
            <Breakdown title="By account code" rows={byAccount} active={f.account} onPick={set("account")} onOpen={(r) => open(`Account ${r.label}${r.sub ? ` ${r.sub}` : ""}`, { account: r.key }, r.labor + r.parts, () => set("account")(r.key))} bind={bind} />
          </div>
          <p className="text-xs text-slate-500">
            Amounts are the report&apos;s Sales Value in Saudi riyals; dollars at the fixed rate of 3.75 SAR = 1 USD. Click any card, point, slice or row to see - and export - the lines behind it. Line detail is
            kept for the last three months; month totals are kept for good.
          </p>
        </>
      )}
      {drill && month && (
        <InvoicingDrill
          month={month}
          drill={drill}
          onClose={() => setDrill(null)}
          onFilter={
            drill.apply
              ? () => {
                  drill.apply!();
                  setDrill(null);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
