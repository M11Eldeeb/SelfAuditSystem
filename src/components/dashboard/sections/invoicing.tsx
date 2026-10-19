"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getInvoicingCounts, getInvoicingData, refreshInvoicing, type InvoicingData, type InvoicingFilter, type InvoicingLine } from "@/app/admin/dashboard/invoicing-actions";
import { InvoicingDrill, type Drill } from "./invoicing-drill";
import { C, Donut, SERIES_COLORS } from "@/components/dashboard/charts";
import { TipCard, useHoverCard } from "@/components/dashboard/hover";
import { Card, Label, Panel, Pill, fmtInt } from "@/components/dashboard/ui";
import { RiyalIcon, Sar } from "@/components/dashboard/riyal";

/** Fixed peg. */
const SAR_PER_USD = 3.75;
const usd = (sar: number, digits = 0) => `$${(sar / SAR_PER_USD).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
/** The data is refreshed by the page itself when the newest import is older than this. */
const STALE_MS = 3 * 3600_000;

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

type Filters = { type: string; account: string; branch: string; operator: string };
const ALL = "";

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
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 min-w-0 rounded-lg border border-[#c0c6db] bg-white px-2 text-sm text-[#0b1c30] focus:border-[#0041b0] focus:outline-none">
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
  const max = Math.max(...rows.map((r) => r.labor + r.parts), 1);
  return (
    <Panel title={title} className="min-w-0">
      <div className="max-h-96 space-y-1 overflow-y-auto pr-1">
        {rows.map((r) => {
          const total = r.labor + r.parts;
          return (
            <div key={r.key} className={`flex items-center gap-1 rounded-lg transition-colors ${active === r.key ? "bg-[#dbe1ff]" : "hover:bg-[#eff4ff]"}`}>
            <button
              type="button"
              onClick={() => onOpen(r)}
              className="block min-w-0 flex-1 px-2 py-1.5 text-left"
              {...bind(
                <TipCard
                  title={r.label}
                  rows={[
                    { label: "Labor", value: `SAR ${r.labor.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, color: C.primary },
                    { label: "Parts", value: `SAR ${r.parts.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, color: C.blue },
                    { label: "Total", value: `SAR ${total.toLocaleString("en-US", { maximumFractionDigits: 0 })} · ${usd(total)}`, strong: true },
                    { label: "Lines", value: fmtInt(r.lines) },
                  ]}
                  note={`${r.sub ? `${r.sub} · ` : ""}Click to see the lines`}
                />
              )}
            >
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate font-medium text-[#0b1c30]">
                  {r.label}
                  {r.sub && <span className="ml-1 text-xs font-normal text-[#575e70]">{r.sub}</span>}
                </span>
                <span className="shrink-0 text-xs font-semibold text-[#0b1c30]">
                  <Sar value={total} /> <span className="font-normal text-[#575e70]">· {usd(total)}</span>
                </span>
              </div>
              <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-[#e5eeff]">
                <div style={{ width: `${(r.labor / max) * 100}%`, backgroundColor: C.primary }} />
                <div style={{ width: `${(r.parts / max) * 100}%`, backgroundColor: C.blue }} />
              </div>
            </button>
            <button
              type="button"
              onClick={() => onPick(active === r.key ? ALL : r.key)}
              title={active === r.key ? "Remove this filter" : "Filter the dashboard by this"}
              className={`shrink-0 rounded-md px-1.5 py-1 text-[11px] font-semibold ${active === r.key ? "text-[#0041b0]" : "text-[#9aa1b5] hover:text-[#0041b0]"}`}
            >
              {active === r.key ? "✕" : "⏷"}
            </button>
            </div>
          );
        })}
        {rows.length === 0 && <p className="py-6 text-center text-sm text-[#575e70]">No lines for these filters.</p>}
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
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }} />
            <span className="truncate text-[#0b1c30]">{r.label}</span>
          </span>
          <span className="shrink-0 text-[#575e70]">
            <Sar value={r.labor + r.parts} /> · {(((r.labor + r.parts) / total) * 100).toFixed(1)}%
          </span>
        </li>
      ))}
    </ul>
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
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(flag ? (CONNECT_MESSAGES[flag] ?? null) : null);
  const [f, setF] = useState<Filters>({ type: "Warranty", account: ALL, branch: ALL, operator: ALL });
  const autoTried = useRef(false);
  const [drill, setDrill] = useState<(Drill & { apply?: () => void }) | null>(null);
  const [counts, setCounts] = useState<{ key: string; workOrders: number; lines: number } | null>(null);
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
    const uniq = (pick: (l: InvoicingLine) => [string, string]) =>
      [...new Map(lines.map((l) => pick(l))).entries()].filter(([k]) => k).sort((a, b) => a[0].localeCompare(b[0]));
    return {
      types: [...new Set(lines.map((l) => l.t).filter(Boolean))].sort(),
      accounts: uniq((l) => [l.ac, l.an]),
      branches: uniq((l) => [l.b, l.bn]),
      operators: uniq((l) => [l.op, l.op]),
    };
  }, [lines]);

  const filtered = useMemo(
    () => lines.filter((l) => (!f.type || l.t === f.type) && (!f.account || l.ac === f.account) && (!f.branch || l.b === f.branch) && (!f.operator || l.op === f.operator)),
    [lines, f]
  );
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
  const byDay = useMemo(() => groupBy(filtered, (l) => l.d ?? "", (l) => l.d ?? "").sort((a, b) => a.key.localeCompare(b.key)), [filtered]);
  const dayMax = Math.max(...byDay.map((d) => d.labor + d.parts), 1);
  const set = (k: keyof Filters) => (v: string) => setF((prev) => ({ ...prev, [k]: v }));
  const base: InvoicingFilter = { type: f.type, account: f.account, branch: f.branch, operator: f.operator };
  const scope = [f.type || "All sales types", f.branch, f.account, f.operator].filter(Boolean).join(" · ");
  const open = (title: string, extra: InvoicingFilter, total?: number, apply?: () => void) => setDrill({ title: `${title} - ${scope}`, filter: { ...base, ...extra }, total, apply });

  // Sales type share ignores the sales type filter (otherwise it is always 100% warranty); department follows every filter.
  const byType = useMemo(
    () => groupBy(lines.filter((l) => (!f.account || l.ac === f.account) && (!f.branch || l.b === f.branch) && (!f.operator || l.op === f.operator)), (l) => l.t || "(none)", (l) => l.t || "(none)"),
    [lines, f.account, f.branch, f.operator]
  );
  const byDept = useMemo(() => groupBy(filtered, (l) => l.dp || "(none)", (l) => l.dp || "(none)"), [filtered]);

  // Invoiced work orders (distinct WIPs) and lines - counted in the database for the current filters.
  const countKey = `${month}|${f.type}|${f.account}|${f.branch}|${f.operator}`;
  useEffect(() => {
    if (!month) return;
    let alive = true;
    getInvoicingCounts(month, { type: f.type, account: f.account, branch: f.branch, operator: f.operator }).then(
      (c) => alive && setCounts({ key: countKey, ...c }),
      () => {}
    );
    return () => {
      alive = false;
    };
  }, [countKey, month, f.type, f.account, f.branch, f.operator]);
  const anyFilter = f.account || f.branch || f.operator || f.type !== "Warranty";

  if (loading && !data) return <div className="h-80 animate-pulse rounded-xl bg-white ring-1 ring-[#dce9ff]/60" />;

  return (
    <div className="space-y-5">
      {layer}
      <Panel
        eyebrow="Warranty invoicing"
        title="Labor + parts invoiced"
        subtitle={
          data?.lastImport
            ? `From the daily report e-mail${data.lastImport.receivedAt ? ` received ${stamp(data.lastImport.receivedAt)}` : ""} · ${data.lastImport.fileName ?? ""}`
            : "From the data analyst's daily \"Major Service Indicators\" report e-mail"
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {data?.connectedAs ? (
              <>
                <Pill tone="muted">Gmail: {data.connectedAs}</Pill>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  disabled={refreshing}
                  className="rounded-lg bg-[#0041b0] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#00309a] disabled:opacity-60"
                >
                  {refreshing ? "Refreshing..." : "↻ Refresh"}
                </button>
                <a href="/api/google-mail/connect?purpose=invoicing" className="text-xs font-medium text-[#575e70] underline">
                  Change mailbox
                </a>
              </>
            ) : (
              <a href="/api/google-mail/connect?purpose=invoicing" className="rounded-lg bg-[#9a000d] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#7a000a]">
                Connect the report mailbox (read-only)
              </a>
            )}
          </div>
        }
      >
        {note && <p className={`mb-3 rounded-lg px-3 py-2 text-sm ${note.ok ? "bg-[#eff4ff] text-[#00174b]" : "bg-[#ffdad6] text-[#93000a]"}`}>{note.text}</p>}
        {!data?.connectedAs && (
          <p className="text-sm text-[#575e70]">
            Sign in with the Google mailbox the daily report arrives in. The portal can only read it - it searches for the e-mail whose subject contains
            &quot;Major Service Indicators Daily Report&quot; and takes its Excel file (KH9-Labor and MG5-Parts sheets).
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
        {anyFilter && (
          <button type="button" onClick={() => setF({ type: "Warranty", account: ALL, branch: ALL, operator: ALL })} className="mt-2 text-xs font-medium text-[#0041b0] underline">
            Reset filters
          </button>
        )}
      </Panel>

      {data && data.months.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              { label: "Labor (KH9)", value: totals.labor, lines: totals.laborLines, accent: C.primary, source: "labor" as const },
              { label: "Parts (MG5)", value: totals.parts, lines: totals.partLines, accent: C.blue, source: "parts" as const },
              { label: "Total", value: totals.total, lines: totals.laborLines + totals.partLines, accent: "#0b1c30", source: undefined },
            ].map((k) => (
              <button key={k.label} type="button" onClick={() => open(k.label, { source: k.source }, k.value)} className="text-left" title="Click to see the lines">
              <Card accent={k.accent} className="h-full transition-shadow hover:shadow-md">
                <Label>{k.label}</Label>
                <div className="mt-1 flex items-center gap-1.5 font-display text-[1.75rem] leading-tight font-bold tracking-tight text-[#0b1c30] tabular-nums">
                  <RiyalIcon className="h-[0.8em] w-[0.8em]" />
                  {k.value.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </div>
                <div className="text-sm font-semibold text-[#575e70]">{usd(k.value)}</div>
                <div className="mt-1 text-xs text-[#575e70]">{fmtInt(k.lines)} lines</div>
              </Card>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <button type="button" onClick={() => open("Invoiced work orders", {}, totals.total)} className="text-left" title="Click to see the lines">
              <Card accent={C.slate} className="h-full transition-shadow hover:shadow-md">
                <Label>Invoiced work orders</Label>
                <div className="mt-1 font-display text-[1.75rem] leading-tight font-bold text-[#0b1c30] tabular-nums">{counts?.key === countKey ? fmtInt(counts.workOrders) : "…"}</div>
                <div className="text-xs text-[#575e70]">distinct WIPs invoiced</div>
              </Card>
            </button>
            <button type="button" onClick={() => open("OBS (invoice lines)", {}, totals.total)} className="text-left" title="Click to see the lines">
              <Card accent={C.slate} className="h-full transition-shadow hover:shadow-md">
                <Label>OBS (lines)</Label>
                <div className="mt-1 font-display text-[1.75rem] leading-tight font-bold text-[#0b1c30] tabular-nums">{fmtInt(totals.laborLines + totals.partLines)}</div>
                <div className="text-xs text-[#575e70]">
                  avg per work order{" "}
                  {counts?.key === countKey && counts.workOrders ? <Sar value={totals.total / counts.workOrders} /> : "…"}
                </div>
              </Card>
            </button>
            <Card accent={C.primary}>
              <Label>Parts to labor ratio</Label>
              <div className="mt-1 font-display text-[1.75rem] leading-tight font-bold text-[#0b1c30] tabular-nums">{totals.labor ? (totals.parts / totals.labor).toFixed(2) : "—"}</div>
              <div className="text-xs text-[#575e70]">parts SAR per 1 SAR labor</div>
            </Card>
            <Card accent={C.blue}>
              <Label>Average per day</Label>
              <div className="mt-1 font-display text-[1.75rem] leading-tight font-bold text-[#0b1c30]">
                <Sar value={byDay.length ? totals.total / byDay.length : 0} />
              </div>
              <div className="text-xs text-[#575e70]">
                {usd(byDay.length ? totals.total / byDay.length : 0)} · over {byDay.length} invoicing days
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Panel title="Sales type" subtitle="Share of the amount - click a slice to see its lines">
              <Donut
                segments={byType.map((t, i) => ({ label: t.label, value: t.labor + t.parts, color: SERIES_COLORS[i % SERIES_COLORS.length] }))}
                center={`${byType.length}`}
                caption="sales types"
                onSelect={(label) => {
                  const t = byType.find((x) => x.label === label);
                  setDrill({ title: `Sales type ${label} - ${[f.branch, f.account, f.operator].filter(Boolean).join(" · ") || "all"}`, filter: { ...base, type: label === "(none)" ? "" : label }, total: t ? t.labor + t.parts : undefined, apply: () => set("type")(label) });
                }}
              />
              <Legend rows={byType} />
            </Panel>
            <Panel title="Department" subtitle="Labor / Consumables / Sublet and parts departments - click a slice to see its lines">
              <Donut
                segments={byDept.map((t, i) => ({ label: t.label, value: t.labor + t.parts, color: SERIES_COLORS[i % SERIES_COLORS.length] }))}
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

          <Panel title="Daily sales" subtitle="Labor and parts per invoice day - hover for the amounts, click a day to see its lines">
            <div className="flex h-40 items-end gap-1">
              {byDay.map((d) => {
                const total = d.labor + d.parts;
                return (
                  <div
                    key={d.key}
                    role="button"
                    tabIndex={0}
                    onClick={() => open(`Invoiced on ${d.key}`, { day: d.key }, total)}
                    onKeyDown={(e) => e.key === "Enter" && open(`Invoiced on ${d.key}`, { day: d.key }, total)}
                    className="flex h-full flex-1 cursor-pointer flex-col justify-end hover:opacity-80"
                    {...bind(
                      <TipCard
                        title={d.key}
                        rows={[
                          { label: "Labor", value: `SAR ${d.labor.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, color: C.primary },
                          { label: "Parts", value: `SAR ${d.parts.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, color: C.blue },
                          { label: "Total", value: `SAR ${total.toLocaleString("en-US", { maximumFractionDigits: 0 })} · ${usd(total)}`, strong: true },
                        ]}
                      />
                    )}
                  >
                    <div style={{ height: `${(d.parts / dayMax) * 100}%`, backgroundColor: C.blue }} className="rounded-t-sm" />
                    <div style={{ height: `${(d.labor / dayMax) * 100}%`, backgroundColor: C.primary }} />
                    <div className="mt-1 text-center text-[10px] text-[#575e70]">{d.key.slice(8)}</div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex gap-4 text-xs text-[#575e70]">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: C.primary }} /> Labor
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: C.blue }} /> Parts
              </span>
            </div>
          </Panel>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Breakdown title="By branch" rows={byBranch} active={f.branch} onPick={set("branch")} onOpen={(r) => open(`Branch ${r.label}${r.sub ? ` ${r.sub}` : ""}`, { branch: r.key }, r.labor + r.parts, () => set("branch")(r.key))} bind={bind} />
            <Breakdown title="Top performance - owing operator" rows={byOperator} active={f.operator} onPick={set("operator")} onOpen={(r) => open(`Owing operator ${r.label}`, { operator: r.key }, r.labor + r.parts, () => set("operator")(r.key))} bind={bind} />
            <Breakdown title="By account code" rows={byAccount} active={f.account} onPick={set("account")} onOpen={(r) => open(`Account ${r.label}${r.sub ? ` ${r.sub}` : ""}`, { account: r.key }, r.labor + r.parts, () => set("account")(r.key))} bind={bind} />
          </div>
          <p className="text-xs text-[#575e70]">
            Amounts are the report&apos;s Sales Value in Saudi riyals; dollars at the fixed rate of 3.75 SAR = 1 USD. Click any card, bar, slice or row to see the lines behind it.
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
