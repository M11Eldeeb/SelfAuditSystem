// Reads the daily "Major Service Indicators" report (the Jiad Aftersales MSI Report workbook, ~10 MB with a dozen sheets):
// the sheets the portal shows are streamed in and turned into plain data. Sheets are found by name and columns by their
// position in the report's fixed layout; a sheet that is missing or laid out differently gives an empty section instead of
// stopping the import. Numbers the workbook could not calculate (errors, formulas without a saved result) come out as null.
import { Readable } from "node:stream";
import ExcelJS from "exceljs";

type Cell = ExcelJS.CellValue;
type Grid = Map<number, Cell[]>;

export type SalesRow = {
  /** "KSA" or the branch code (A7, B7, ...). */
  scope: string;
  scopeName: string;
  /** "Totals" (the summary lines) or "Breakdown" (labor, consumables, sublet, parts, lubes ...). */
  part: "Totals" | "Breakdown";
  type: string;
  channel: string;
  actual: number | null;
  mtdTarget: number | null;
  mtdPct: number | null;
  monthTarget: number | null;
  monthPct: number | null;
  forecast: number | null;
  ytdActual: number | null;
  ytdTarget: number | null;
  ytdPct: number | null;
};

export type MonthCell = { actual: number | null; target: number | null; pct: number | null; avg: number | null };
export type MonthlyRow = { scope: string; scopeName: string; part: "Totals" | "Breakdown"; type: string; channel: string; months: MonthCell[]; ytd: MonthCell; mtd: { actual: number | null; target: number | null; pct: number | null; monthEndTarget: number | null; monthEndPct: number | null } };

export type DailyRow = { scope: string; scopeName: string; part: "Totals" | "Breakdown"; type: string; channel: string; monthTarget: number | null; dailyTarget: number | null; days: (number | null)[] };

export type KpiMonth = { labor: number | null; hours: number | null; recovery: number | null; parts: number | null; ratio: number | null };
export type KpiRow = { branch: string; channel: string; months: KpiMonth[]; ytd: KpiMonth };

export type WholesaleRow = { name: string; channel: string; actual: number | null; mtdTarget: number | null; mtdPct: number | null; monthTarget: number | null; monthPct: number | null; forecast: number | null; ytdActual: number | null; ytdTarget: number | null; ytdPct: number | null; isTotal: boolean };

export type AdvisorRow = {
  name: string;
  branch: string;
  region: string;
  /** "advisor", "region" (a region's total) or "total" (all advisors). */
  kind: "advisor" | "region" | "total";
  /** What the advisor sold in the earlier months (labor, parts, total), by month number 1-12. */
  earlier: Record<string, { labor: number | null; parts: number | null; total: number | null }>;
  achievement: { labor: number | null; parts: number | null; total: number | null };
  target: { labor: number | null; parts: number | null; total: number | null };
  /** Text instead of a target ("Not SA", "I7 Closed" ...). */
  targetNote: string | null;
  avgDailyTarget: number | null;
  revisedDailyTarget: number | null;
  pctMonth: number | null;
  pctMtd: number | null;
  runrate: number | null;
  /** The current month day by day: [day of month, labor, parts, total]. */
  daily: [number, number | null, number | null, number | null][];
};

export type SaTargetRow = { branch: string; advisor: string; months: (number | string | null)[]; total: number | null };

export type MsiMeta = {
  runDate: string;
  workingDays: number | null;
  daysPassed: number | null;
  daysRemaining: number | null;
  /** Working days of each month of the year (Jan..Dec). */
  monthWorkingDays: (number | null)[];
  year: number;
  month: number;
};

export type MsiParsed = {
  meta: MsiMeta;
  sales: SalesRow[];
  advisors: AdvisorRow[];
  wholesale: WholesaleRow[];
  extra: { monthly: MonthlyRow[]; daily: DailyRow[]; kpis: KpiRow[]; saTargets: SaTargetRow[] };
  /** What could not be read (for the import log). */
  notes: string[];
};

// ---------- cells ----------

const plain = (c: Cell): string | number | Date | null => {
  if (c == null) return null;
  if (c instanceof Date || typeof c === "string" || typeof c === "number") return c;
  if (typeof c === "boolean") return c ? 1 : 0;
  if (typeof c === "object") {
    if ("result" in c) {
      const r = (c as { result?: unknown }).result;
      if (r != null && typeof r === "object" && !(r instanceof Date)) return null; // #DIV/0! and friends
      return plain(r as Cell);
    }
    if ("richText" in c) return c.richText.map((r) => r.text).join("");
    if ("text" in c) return String(c.text);
    return null; // a formula with no saved result
  }
  return null;
};
const text = (c: Cell): string => {
  const v = plain(c);
  return v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).replace(/\s+/g, " ").trim();
};
const num = (c: Cell): number | null => {
  const v = plain(c);
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null;
  if (typeof v === "string" && /^-?[\d,]*\.?\d+$/.test(v.trim())) return Math.round(Number(v.replace(/,/g, "")) * 10000) / 10000;
  return null;
};
const isoDay = (c: Cell): string | null => {
  const v = plain(c);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 30000 && v < 80000) return new Date(Math.round((v - 25569) * 86_400_000)).toISOString().slice(0, 10);
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = String(v ?? "").match(/^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{4})/); // "Mon Nov 16 2026 03:00:00 GMT+0300"
  if (d) {
    const mm = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(d[1].toLowerCase());
    if (mm >= 0) return `${d[3]}-${String(mm + 1).padStart(2, "0")}-${d[2].padStart(2, "0")}`;
  }
  return null;
};
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const at = (grid: Grid, r: number, c: number): Cell => grid.get(r)?.[c] ?? null;

// ---------- reading the workbook ----------

const WANTED = ["monthly sales performance", "daily advisor performance", "sa targets", "sales monthly closing", "wholesales & affiliates", "kpis performance", "working days", "daily sales"];

async function readGrids(bytes: Buffer): Promise<Map<string, Grid>> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(bytes), {
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
    worksheets: "emit",
    entries: "emit",
  });
  const out = new Map<string, Grid>();
  for await (const ws of reader) {
    const name = norm((ws as unknown as { name: string }).name);
    const keep = WANTED.includes(name);
    const grid: Grid = new Map();
    for await (const row of ws) {
      if (!keep) continue; // the two big data sheets (KH9 labor, MG5 parts) and the helpers are not read
      const r = row as ExcelJS.Row;
      grid.set(r.number, r.values as Cell[]);
    }
    if (keep) out.set(name, grid);
  }
  return out;
}

// ---------- the report's row labels (branch / sales type / channel, with merged cells filled in) ----------

type Label = { scope: string; scopeName: string; part: "Totals" | "Breakdown"; type: string; channel: string; row: number };

/** The labels of the rows from `first` on: the branch block (KSA, A7, B7 ...), Totals or Breakdown, sales type and channel. */
function labelRows(grid: Grid, first: number, cols = { b: 2, c: 3, d: 4 }): Label[] {
  const out: Label[] = [];
  let scope = "KSA";
  let scopeName = "KSA";
  let b = "";
  let c = "";
  let pendingName = false;
  const last = Math.max(...grid.keys(), 0);
  for (let r = first; r <= last; r++) {
    const row = grid.get(r);
    if (!row) continue;
    const bt = text(row[cols.b]);
    const ct = text(row[cols.c]);
    const dt = text(row[cols.d]);
    if (!bt && !ct && !dt) continue;
    if (bt) b = bt;
    if (ct) c = ct;
    if (/^[A-Z]\d$/.test(bt)) {
      // The first line of a branch block: its code, its name and its grand total.
      scope = bt;
      scopeName = ct.replace(/\s+Total$/i, "").trim() || bt;
      pendingName = true;
      out.push({ scope, scopeName, part: "Totals", type: "Branch total", channel: dt || "with Counter", row: r });
      continue;
    }
    // A line whose channel cell is merged into its sales type ("All Branchs Total"): kept when it carries figures.
    const hasFigures = (row as Cell[]).slice(5).some((v) => num(v) != null);
    if (!dt && !(ct && hasFigures)) continue;
    if (pendingName && bt) {
      const name = bt.replace(/\s+(Totals?|Breakdown)$/i, "").trim();
      if (name && name.length > 2) {
        scopeName = name;
        for (const l of out) if (l.scope === scope) l.scopeName = name;
        pendingName = false;
      }
    }
    const part: "Totals" | "Breakdown" = /breakdown$/i.test(b) ? "Breakdown" : "Totals";
    out.push({ scope: /^KSA|^All Breakdown/i.test(b) && scope === "KSA" ? "KSA" : scope, scopeName, part, type: dt ? c || b : ct, channel: dt || ct, row: r });
  }
  return out;
}

// ---------- the sheets ----------

function parseSales(grid: Grid): SalesRow[] {
  return labelRows(grid, 9).map((l) => {
    const row = grid.get(l.row)!;
    return {
      scope: l.scope,
      scopeName: l.scopeName,
      part: l.part,
      type: l.type,
      channel: l.channel,
      actual: num(row[5]),
      mtdTarget: num(row[6]),
      mtdPct: num(row[7]),
      monthTarget: num(row[8]),
      monthPct: num(row[9]),
      forecast: num(row[10]),
      ytdActual: num(row[11]),
      ytdTarget: num(row[12]),
      ytdPct: num(row[13]),
    };
  });
}

function parseMonthly(grid: Grid): MonthlyRow[] {
  const cell = (row: Cell[], c: number): MonthCell => ({ actual: num(row[c]), target: num(row[c + 1]), pct: num(row[c + 2]), avg: num(row[c + 3]) });
  return labelRows(grid, 9).map((l) => {
    const row = grid.get(l.row)!;
    return {
      scope: l.scope,
      scopeName: l.scopeName,
      part: l.part,
      type: l.type,
      channel: l.channel,
      months: Array.from({ length: 12 }, (_, m) => cell(row, 5 + m * 4)),
      ytd: cell(row, 53),
      mtd: { actual: num(row[58]), target: num(row[59]), pct: num(row[60]), monthEndTarget: num(row[61]), monthEndPct: num(row[62]) },
    };
  });
}

function parseDaily(grid: Grid): DailyRow[] {
  return labelRows(grid, 9).map((l) => {
    const row = grid.get(l.row)!;
    return {
      scope: l.scope,
      scopeName: l.scopeName,
      part: l.part,
      type: l.type,
      channel: l.channel,
      monthTarget: num(row[5]),
      dailyTarget: num(row[6]),
      days: Array.from({ length: 31 }, (_, d) => num(row[7 + d])),
    };
  });
}

function parseKpis(grid: Grid): KpiRow[] {
  const cell = (row: Cell[], c: number): KpiMonth => ({ labor: num(row[c]), hours: num(row[c + 1]), recovery: num(row[c + 2]), parts: num(row[c + 3]), ratio: num(row[c + 4]) });
  const out: KpiRow[] = [];
  const last = Math.max(...grid.keys(), 0);
  let branch = "";
  for (let r = 5; r <= last; r++) {
    const row = grid.get(r);
    if (!row) continue;
    const channel = text(row[4]);
    if (!channel) continue;
    // A branch's block starts at its "<name> Total" line (the branch name is in the first column there); its channels follow.
    const isTotal = /total$/i.test(channel);
    if (isTotal) branch = text(row[2]) || channel.replace(/s+Total$/i, "");
    if (!branch) continue;
    out.push({ branch, channel: isTotal ? "Total" : channel, months: Array.from({ length: 12 }, (_, m) => cell(row, 5 + m * 5)), ytd: cell(row, 65) });
  }
  return out;
}

function parseWholesale(grid: Grid): WholesaleRow[] {
  const out: WholesaleRow[] = [];
  const last = Math.max(...grid.keys(), 0);
  for (let r = 9; r <= last; r++) {
    const row = grid.get(r);
    if (!row) continue;
    const name = text(row[2]);
    if (!name) continue;
    const channel = text(row[3]);
    out.push({
      name,
      channel,
      actual: num(row[4]),
      mtdTarget: num(row[5]),
      mtdPct: num(row[6]),
      monthTarget: num(row[7]),
      monthPct: num(row[8]),
      forecast: num(row[9]),
      ytdActual: num(row[10]),
      ytdTarget: num(row[11]),
      ytdPct: num(row[12]),
      isTotal: /total/i.test(name),
    });
  }
  return out;
}

function parseAdvisors(grid: Grid, runDate: string): AdvisorRow[] {
  const head4 = grid.get(4) ?? [];
  const head5 = grid.get(5) ?? [];
  const monthOfRun = runDate.slice(0, 7);
  // Columns by their headers: the date columns (Labor / Parts / Total under each date) and the summary columns.
  const dateOf = new Map<number, string>();
  let achievementCol = -1;
  let targetCol = -1;
  const single: Record<string, number> = {};
  for (let c = 5; c < head4.length; c++) {
    const h4 = text(head4[c]);
    const d = isoDay(head4[c]);
    if (d && !/achievement|target|runrate/i.test(h4)) dateOf.set(c, d);
    else if (/total achievement/i.test(h4) && achievementCol < 0) achievementCol = c;
    else if (/monthly target/i.test(h4) && targetCol < 0) targetCol = c;
    const h5 = norm(text(head5[c]) || h4); // a header merged over both rows is in the top cell only
    if (h5.startsWith("avg. daily target")) single.avg = c;
    else if (h5.startsWith("revised daily target")) single.revised = c;
    else if (h5.startsWith("% achievement monthly")) single.pctMonth = c;
    else if (h5.startsWith("% achievement mtd")) single.pctMtd = c;
    else if (h5.startsWith("runrate")) single.runrate = c;
  }
  // The date columns come in threes (Labor, Parts, Total); a head5 "Target" column sits first under the first month.
  const dateCols = new Map<string, { labor: number; parts: number; total: number }>();
  for (const [c, d] of dateOf) {
    const kind = norm(text(head5[c]));
    const e = dateCols.get(d) ?? { labor: -1, parts: -1, total: -1 };
    if (kind === "labor") e.labor = c;
    else if (kind === "parts") e.parts = c;
    else if (kind === "total") e.total = c;
    dateCols.set(d, e);
  }
  const out: AdvisorRow[] = [];
  const last = Math.max(...grid.keys(), 0);
  for (let r = 6; r <= last; r++) {
    const row = grid.get(r);
    if (!row) continue;
    const name = text(row[2]);
    if (!name) continue;
    const kind: AdvisorRow["kind"] = /^grand total$/i.test(name) ? "total" : /region( total)?$/i.test(name) && !text(row[3]) ? "region" : text(row[3]) ? "advisor" : "region";
    const triple = (c: number) => ({ labor: num(row[c]), parts: num(row[c + 1]), total: num(row[c + 2]) });
    const tgt = targetCol >= 0 ? triple(targetCol) : { labor: null, parts: null, total: null };
    const note = targetCol >= 0 && typeof plain(row[targetCol]) === "string" && num(row[targetCol]) == null ? text(row[targetCol]) : "";
    const earlier: AdvisorRow["earlier"] = {};
    const daily: AdvisorRow["daily"] = [];
    for (const [d, cols] of dateCols) {
      const v = { labor: cols.labor >= 0 ? num(row[cols.labor]) : null, parts: cols.parts >= 0 ? num(row[cols.parts]) : null, total: cols.total >= 0 ? num(row[cols.total]) : null };
      if (d.startsWith(monthOfRun)) {
        if (v.labor != null || v.parts != null || v.total != null) daily.push([Number(d.slice(8, 10)), v.labor, v.parts, v.total]);
      } else if (v.labor != null || v.parts != null || v.total != null) earlier[d.slice(0, 7)] = v;
    }
    daily.sort((a, b) => a[0] - b[0]);
    out.push({
      name,
      branch: text(row[3]),
      region: text(row[4]),
      kind,
      earlier,
      achievement: achievementCol >= 0 ? triple(achievementCol) : { labor: null, parts: null, total: null },
      target: tgt,
      targetNote: note || null,
      avgDailyTarget: single.avg != null ? num(row[single.avg]) : null,
      revisedDailyTarget: single.revised != null ? num(row[single.revised]) : null,
      pctMonth: single.pctMonth != null ? num(row[single.pctMonth]) : null,
      pctMtd: single.pctMtd != null ? num(row[single.pctMtd]) : null,
      runrate: single.runrate != null ? num(row[single.runrate]) : null,
      daily,
    });
  }
  return out;
}

function parseSaTargets(grid: Grid): SaTargetRow[] {
  const out: SaTargetRow[] = [];
  const last = Math.max(...grid.keys(), 0);
  for (let r = 3; r <= last; r++) {
    const row = grid.get(r);
    if (!row) continue;
    const branch = text(row[3]);
    const advisor = text(row[4]);
    if (!branch || !advisor || !/^[A-Z]\d$/.test(branch)) continue;
    out.push({
      branch,
      advisor,
      months: Array.from({ length: 12 }, (_, m) => {
        const v = plain(row[5 + m]);
        return typeof v === "number" ? Math.round(v) : v == null ? null : String(v).trim() || null;
      }),
      total: num(row[17]),
    });
  }
  return out;
}

function parseMeta(grids: Map<string, Grid>, notes: string[]): MsiMeta {
  const sales = grids.get("monthly sales performance") ?? new Map();
  const runDate = isoDay(at(sales, 2, 4)) ?? isoDay(at(grids.get("wholesales & affiliates") ?? new Map(), 2, 5)) ?? new Date().toISOString().slice(0, 10);
  if (!isoDay(at(sales, 2, 4))) notes.push("The run date was not found in the report - today's date is used.");
  const wd = grids.get("working days") ?? new Map();
  return {
    runDate,
    workingDays: num(at(sales, 3, 4)),
    daysPassed: num(at(sales, 4, 4)),
    daysRemaining: num(at(sales, 5, 4)),
    monthWorkingDays: Array.from({ length: 12 }, (_, m) => num(at(wd, 3, 3 + m))),
    year: Number(runDate.slice(0, 4)),
    month: Number(runDate.slice(5, 7)),
  };
}

export async function parseMsiReport(bytes: Buffer): Promise<MsiParsed> {
  const grids = await readGrids(bytes);
  const notes: string[] = [];
  const need = (name: string) => {
    const g = grids.get(name);
    if (!g) notes.push(`The sheet "${name}" is not in the report.`);
    return g ?? new Map<number, Cell[]>();
  };
  const meta = parseMeta(grids, notes);
  const sales = parseSales(need("monthly sales performance"));
  if (!sales.length) throw new Error('The report has no "Monthly Sales Performance" figures.');
  return {
    meta,
    sales,
    advisors: parseAdvisors(need("daily advisor performance"), meta.runDate),
    wholesale: parseWholesale(need("wholesales & affiliates")),
    extra: {
      monthly: parseMonthly(need("sales monthly closing")),
      daily: parseDaily(need("daily sales")),
      kpis: parseKpis(need("kpis performance")),
      saTargets: parseSaTargets(need("sa targets")),
    },
    notes,
  };
}
