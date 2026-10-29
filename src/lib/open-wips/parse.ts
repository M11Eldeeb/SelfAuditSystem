import { dealerCodeOf } from "@/lib/complaints/codes";

/** One open WIP as stored (without branch_id / first_seen, added on import). */
export type ParsedWip = {
  key: string;
  dealer_code: string;
  dept: string | null;
  wip_no: string;
  job: string | null;
  in_out: string | null;
  received: string | null;
  due_out: string | null;
  invoiceable: number | null;
  wip_parts: number | null;
  wip_labour: number | null;
  account: string | null;
  invoice_no: string | null;
  status_code: string | null;
  wip_status: string | null;
  parts_status: string | null;
  vin: string | null;
  taken_hr: number | null;
  operator: string | null;
  registration: string | null;
  model: string | null;
  note1: string | null;
  note2: string | null;
  note3: string | null;
  note4: string | null;
  order_ref: string | null;
  approve: string | null;
  insurer: string | null;
  mileage: number | null;
  sale_type: string | null;
  taken: number | null;
  brand: string | null;
  repeat_repair: string | null;
};

/** The report's header names (FF3), matched case-insensitively. */
const H: Record<Exclude<keyof ParsedWip, "key" | "dealer_code">, string[]> & { co: string[] } = {
  co: ["co", "company"],
  dept: ["d", "dept"],
  wip_no: ["wipno", "wip no", "wip"],
  job: ["job"],
  in_out: ["in", "in/out"],
  received: ["rcvd dat", "rcvd date", "received"],
  due_out: ["due out"],
  invoiceable: ["invoicable", "invoiceable"],
  wip_parts: ["wip parts"],
  wip_labour: ["wip labour", "wip labor"],
  account: ["a/c num", "account"],
  invoice_no: ["invoi", "invoice"],
  status_code: ["s"],
  wip_status: ["wip status"],
  parts_status: ["parts status"],
  vin: ["chassis", "vin"],
  taken_hr: ["taken hr"],
  operator: ["operator", "service advisor"],
  registration: ["regis", "registration"],
  model: ["make/model", "model"],
  note1: ["note-1", "note 1"],
  note2: ["note-2", "note 2"],
  note3: ["note-3", "note 3"],
  note4: ["note-4", "note 4"],
  order_ref: ["ord rf", "order ref"],
  approve: ["approve"],
  insurer: ["insurer"],
  mileage: ["mila", "mileage"],
  sale_type: ["description"],
  taken: ["taken"],
  brand: ["brad", "brand"],
  repeat_repair: ["repeat repair"],
};

const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/[|]/g, "").replace(/\s+/g, " ").trim();
const str = (v: unknown): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return s ? s : null;
};
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** A date cell: a Sheets/Excel serial number, a Date, ISO text, or day-first text (28/01/2026) - or month-first for `mdy`. */
export function toDay(v: unknown, mdy = false): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000).toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (!m) return null;
  let [a, b] = [Number(m[1]), Number(m[2])];
  if (mdy && a <= 12) [a, b] = [b, a];
  else if (!mdy && b > 12 && a <= 12) [a, b] = [b, a];
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  if (a < 1 || a > 31 || b < 1 || b > 12) return null;
  return `${y}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`;
}

/** The FF3 rows. Throws when the header row is not found. */
export function parseOpenWips(values: unknown[][]): ParsedWip[] {
  const h = values.findIndex((r) => r.some((c) => norm(c) === "wipno") && r.some((c) => norm(c) === "operator"));
  if (h < 0) throw new Error('No header row with "WIPNO" and "Operator" found.');
  const header = values[h].map(norm);
  const col = {} as Record<keyof typeof H, number>;
  const used = new Set<number>();
  for (const [k, names] of Object.entries(H) as [keyof typeof H, string[]][]) {
    let idx = -1;
    for (const n of names) {
      idx = header.findIndex((x, i) => x === n && !used.has(i));
      if (idx >= 0) break;
    }
    col[k] = idx;
    if (idx >= 0) used.add(idx);
  }
  const get = (r: unknown[], k: keyof typeof H) => (col[k] >= 0 ? r[col[k]] : null);
  const out = new Map<string, ParsedWip>();
  for (const r of values.slice(h + 1)) {
    const code = dealerCodeOf(String(get(r, "co") ?? ""));
    const wip = str(get(r, "wip_no"));
    if (!code || !wip) continue;
    const key = `${code}|${wip}`;
    out.set(key, {
      key,
      dealer_code: code,
      dept: str(get(r, "dept")),
      wip_no: wip,
      job: str(get(r, "job")),
      in_out: str(get(r, "in_out"))?.toUpperCase() ?? null,
      received: toDay(get(r, "received")),
      due_out: toDay(get(r, "due_out")),
      invoiceable: num(get(r, "invoiceable")),
      wip_parts: num(get(r, "wip_parts")),
      wip_labour: num(get(r, "wip_labour")),
      account: str(get(r, "account")),
      invoice_no: str(get(r, "invoice_no")),
      status_code: str(get(r, "status_code")),
      wip_status: str(get(r, "wip_status")),
      parts_status: str(get(r, "parts_status")),
      vin: str(get(r, "vin"))?.toUpperCase() ?? null,
      taken_hr: num(get(r, "taken_hr")),
      operator: str(get(r, "operator")),
      registration: str(get(r, "registration")),
      model: str(get(r, "model")),
      note1: str(get(r, "note1")),
      note2: str(get(r, "note2")),
      note3: str(get(r, "note3")),
      note4: str(get(r, "note4")),
      order_ref: str(get(r, "order_ref")),
      approve: str(get(r, "approve")),
      insurer: str(get(r, "insurer")),
      mileage: num(get(r, "mileage")),
      sale_type: str(get(r, "sale_type")),
      taken: num(get(r, "taken")),
      brand: str(get(r, "brand")),
      repeat_repair: str(get(r, "repeat_repair")),
    });
  }
  return [...out.values()];
}

/** The sheet's "Daily History" tab: Date (month-first), Co, Operator, Count. */
export function parseDailyHistory(values: unknown[][]): { day: string; dealer_code: string; operator: string; count: number }[] {
  const h = values.findIndex((r) => r.some((c) => norm(c) === "operator") && r.some((c) => norm(c) === "count"));
  if (h < 0) return [];
  const header = values[h].map(norm);
  const [d, co, op, n] = ["date", "co", "operator", "count"].map((x) => header.indexOf(x));
  const out = new Map<string, { day: string; dealer_code: string; operator: string; count: number }>();
  for (const r of values.slice(h + 1)) {
    const day = toDay(r[d], true);
    const code = dealerCodeOf(String(r[co] ?? ""));
    const operator = str(r[op]);
    const count = num(r[n]);
    if (!day || !code || !operator || count == null) continue;
    out.set(`${day}|${code}|${operator}`, { day, dealer_code: code, operator, count: Math.round(count) });
  }
  return [...out.values()];
}
