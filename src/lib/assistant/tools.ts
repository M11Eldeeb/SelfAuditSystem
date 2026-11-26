import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { DATASETS, loadDataset, lookup, warrantyKpis, type AssistantUser, type Cell, type DatasetName, type Row } from "./data";
import { loadFleet } from "@/lib/courtesy/fleet-server";
import { CONDITIONS, type Condition } from "@/lib/courtesy/fleet";
import { setVehicleCondition } from "@/app/actions/courtesy-fleet";
import { addWipComment, getOpenWips } from "@/app/actions/open-wips";

/** A table the assistant produced; the chat shows it under the answer with a CSV download. */
export type ResultTable = { title: string; columns: string[]; rows: Cell[][] };
/** A change the assistant proposes; it only runs after the person presses Confirm. */
export type Proposal = { token: string; summary: string };

export const TOOLS: BetaTool[] = [
  {
    name: "lookup",
    description:
      "Everything the portal knows about ONE vehicle or job: give a WIP number, VIN (or its last digits), plate or claim number. Returns the job cards, claims, invoices, complaints, courtesy loans and history for it. Use it for questions about a specific car/WIP/claim.",
    input_schema: { type: "object", properties: { input: { type: "string", description: "WIP, VIN, plate or claim number" } }, required: ["input"] },
  },
  {
    name: "query_data",
    description:
      "Filter, group and count the portal's live data (already limited to what this person may see). Datasets and their fields:\n" +
      Object.entries(DATASETS).map(([k, v]) => `- ${k}: ${v}`).join("\n") +
      "\nWithout group_by it returns matching rows (pick the fields you need). With group_by it returns one row per group with the metrics (default metric: count). Text filters ignore case. Dates are YYYY-MM-DD (Saudi time). Set show_table to true when the person asked for a list or report: the full result is then shown to them as a table they can download, so only summarise it in your text.",
    input_schema: {
      type: "object",
      properties: {
        dataset: { type: "string", enum: Object.keys(DATASETS) },
        days: { type: "integer", description: "queue_visits / appointments only: how many days back (1-90)" },
        filters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              op: { type: "string", enum: ["eq", "neq", "contains", "not_contains", "gt", "gte", "lt", "lte", "in", "empty", "not_empty"] },
              value: { description: "a value, or a list for 'in'" },
            },
            required: ["field", "op"],
          },
        },
        group_by: { type: "array", items: { type: "string" } },
        metrics: {
          type: "array",
          items: {
            type: "object",
            properties: { fn: { type: "string", enum: ["count", "sum", "avg", "min", "max", "count_true"] }, field: { type: "string" } },
            required: ["fn"],
          },
        },
        fields: { type: "array", items: { type: "string" }, description: "columns to return when not grouping" },
        sort: { type: "object", properties: { field: { type: "string" }, desc: { type: "boolean" } }, required: ["field"] },
        limit: { type: "integer", description: "rows to return (default 50, max 300)" },
        show_table: { type: "boolean" },
        title: { type: "string", description: "title of the table shown to the person" },
      },
      required: ["dataset"],
    },
  },
  {
    name: "warranty_kpis",
    description:
      "Warranty KPI figures per branch and in total for a range of months - the same numbers as the portal's KPI dashboard: claims, claim and adjusted amount (SAR), submitted, accepted first time, claims per WIP, average repair-completion and claim-submission days, warranty-room parts, parts flagged to scrap. Months are YYYY-MM; leave both out for the current month.",
    input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, show_table: { type: "boolean" } } },
  },
  {
    name: "propose_action",
    description:
      "Propose a change in the portal. Nothing happens until the person presses Confirm on the card the chat shows, so never say it is done. Actions:\n" +
      "- set_courtesy_car_condition: params { plate, condition: available|maintenance|accident|on_hold|out_of_service, note } (note required unless available)\n" +
      "- add_wip_comment: params { wip, branch (optional when the WIP number is unique), text }\n" +
      "Look the item up first if you are not sure it exists. One proposal per call.",
    input_schema: {
      type: "object",
      properties: { action: { type: "string", enum: ["set_courtesy_car_condition", "add_wip_comment"] }, params: { type: "object" } },
      required: ["action", "params"],
    },
  },
];

// ---------- query engine ----------

type Filter = { field: string; op: string; value?: unknown };
type Metric = { fn: string; field?: string };

const norm = (v: unknown) => (v == null ? "" : String(v).toLowerCase().trim());
const num = (v: unknown) => (typeof v === "number" ? v : v == null || v === "" ? NaN : Number(v));

function matches(row: Row, f: Filter): boolean {
  const v = row[f.field];
  switch (f.op) {
    case "eq": return typeof v === "boolean" ? v === (f.value === true || norm(f.value) === "true") : norm(v) === norm(f.value);
    case "neq": return norm(v) !== norm(f.value);
    case "contains": return norm(v).includes(norm(f.value));
    case "not_contains": return !norm(v).includes(norm(f.value));
    case "in": return (Array.isArray(f.value) ? f.value : [f.value]).some((x) => norm(x) === norm(v));
    case "empty": return v == null || v === "";
    case "not_empty": return !(v == null || v === "");
    default: {
      const a = num(v), b = num(f.value);
      const cmp = !isNaN(a) && !isNaN(b) ? a - b : norm(v).localeCompare(norm(f.value));
      if (v == null) return false;
      return f.op === "gt" ? cmp > 0 : f.op === "gte" ? cmp >= 0 : f.op === "lt" ? cmp < 0 : cmp <= 0;
    }
  }
}

function aggregate(rows: Row[], m: Metric): Cell {
  if (m.fn === "count") return rows.length;
  if (m.fn === "count_true") return rows.filter((r) => r[m.field ?? ""] === true).length;
  const vals = rows.map((r) => num(r[m.field ?? ""])).filter((x) => !isNaN(x));
  if (!vals.length) return null;
  const s = vals.reduce((a, b) => a + b, 0);
  const out = m.fn === "sum" ? s : m.fn === "avg" ? s / vals.length : m.fn === "min" ? Math.min(...vals) : Math.max(...vals);
  return Math.round(out * 100) / 100;
}

function runQuery(all: Row[], input: Record<string, unknown>) {
  const known = new Set(all.length ? Object.keys(all[0]) : []);
  const filters = (input.filters as Filter[] | undefined) ?? [];
  const bad = [...filters.map((f) => f.field), ...((input.group_by as string[]) ?? [])].filter((f) => known.size && !known.has(f));
  if (bad.length) return { error: `Unknown field(s): ${bad.join(", ")}. Fields: ${[...known].join(", ")}` };
  const rows = all.filter((r) => filters.every((f) => matches(r, f)));
  const limit = Math.max(1, Math.min(300, Number(input.limit) || 50));
  const sort = input.sort as { field: string; desc?: boolean } | undefined;
  const sorter = (a: Row, b: Row) => {
    if (!sort) return 0;
    const x = a[sort.field], y = b[sort.field];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return sort.desc ? -c : c;
  };
  const groupBy = (input.group_by as string[] | undefined) ?? [];
  if (groupBy.length) {
    const metrics = ((input.metrics as Metric[] | undefined) ?? []).length ? (input.metrics as Metric[]) : [{ fn: "count" }];
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const k = JSON.stringify(groupBy.map((g) => r[g] ?? null));
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    const names = metrics.map((m) => (m.fn === "count" ? "count" : `${m.fn}_${m.field}`));
    let out: Row[] = [...groups.entries()].map(([k, g]) => {
      const keys = JSON.parse(k) as Cell[];
      const row: Row = {};
      groupBy.forEach((f, i) => (row[f] = keys[i]));
      metrics.forEach((m, i) => (row[names[i]] = aggregate(g, m)));
      return row;
    });
    out = sort ? out.sort(sorter) : out.sort((a, b) => Number(b[names[0]] ?? 0) - Number(a[names[0]] ?? 0));
    return { matched_rows: rows.length, groups: out.length, columns: [...groupBy, ...names], rows: out.slice(0, limit), truncated: out.length > limit };
  }
  const fields = ((input.fields as string[] | undefined) ?? []).filter((f) => known.has(f));
  const cols = fields.length ? fields : [...known];
  const sorted = sort ? [...rows].sort(sorter) : rows;
  return {
    matched_rows: rows.length,
    columns: cols,
    rows: sorted.slice(0, limit).map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null]))),
    truncated: rows.length > limit,
  };
}

// ---------- confirm tokens ----------

const secret = () => createHmac("sha256", process.env.ASSISTANT_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").update("portal-assistant").digest();
const b64 = (s: string) => Buffer.from(s).toString("base64url");

type Pending = { u: string; a: "set_courtesy_car_condition" | "add_wip_comment"; p: Record<string, string>; exp: number };

function sign(p: Pending) {
  const body = b64(JSON.stringify(p));
  return `${body}.${createHmac("sha256", secret()).update(body).digest("base64url")}`;
}

export function verify(token: string, userId: string): Pending | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const want = createHmac("sha256", secret()).update(body).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const p = JSON.parse(Buffer.from(body, "base64url").toString()) as Pending;
  return p.u === userId && p.exp > Date.now() ? p : null;
}

/** Runs a confirmed change. The portal's own action checks the person may do it. */
export async function execute(p: Pending): Promise<{ ok: boolean; message: string }> {
  if (p.a === "set_courtesy_car_condition") {
    const r = await setVehicleCondition(p.p.vehicleId, p.p.condition as Condition, p.p.note ?? "");
    return r.error ? { ok: false, message: r.error } : { ok: true, message: `${p.p.plate} is now ${p.p.conditionLabel}.` };
  }
  const r = await addWipComment(p.p.key, p.p.text);
  return r.error ? { ok: false, message: r.error } : { ok: true, message: `Comment added to WIP ${p.p.wip}.` };
}

async function propose(au: AssistantUser, action: string, params: Record<string, unknown>): Promise<{ result: string; proposal?: Proposal }> {
  const exp = Date.now() + 15 * 60_000;
  if (au.user.viewOnly) return { result: "This account is view only, so it cannot change anything. Tell the person." };
  if (action === "set_courtesy_car_condition") {
    const plate = norm(params.plate).replace(/\s+/g, "");
    const condition = String(params.condition ?? "") as Condition;
    const c = CONDITIONS.find((x) => x.id === condition);
    if (!c) return { result: `Unknown condition. Use one of: ${CONDITIONS.map((x) => x.id).join(", ")}` };
    const note = String(params.note ?? "").trim();
    if (condition !== "available" && !note) return { result: "A note is required (what happened / until when). Ask the person for it." };
    const { rows } = await loadFleet(au.branchId);
    const hits = rows.filter((r) => norm(r.plate).replace(/\s+/g, "").includes(plate));
    if (hits.length !== 1) return { result: hits.length ? `Several cars match: ${hits.map((h) => h.plate).join(", ")}. Ask which one.` : "No courtesy car with that plate in your fleet." };
    const v = hits[0];
    const summary = `Set courtesy car ${v.plate} (${v.model ?? ""}, ${v.branchName ?? ""}) to "${c.label}"${note ? ` - note: ${note}` : ""}`;
    return {
      result: `Proposal shown to the person for confirmation: ${summary}. Current condition: ${v.condition}${v.loan ? ", the car is on loan" : ""}.`,
      proposal: { summary, token: sign({ u: au.user.id, a: "set_courtesy_car_condition", p: { vehicleId: v.id, plate: v.plate, condition, conditionLabel: c.label, note }, exp }) },
    };
  }
  if (action === "add_wip_comment") {
    const wip = String(params.wip ?? "").trim();
    const text = String(params.text ?? "").trim().slice(0, 2000);
    if (!wip || !text) return { result: "Both the WIP number and the comment text are needed." };
    const { wips } = await getOpenWips();
    let hits = wips.filter((w) => String(w.wip) === wip);
    if (params.branch) hits = hits.filter((w) => norm(w.branch).includes(norm(params.branch)));
    if (hits.length !== 1) return { result: hits.length ? `WIP ${wip} is open in several branches (${hits.map((h) => h.branch).join(", ")}). Ask which branch.` : `WIP ${wip} is not in the open WIPs you can see.` };
    const w = hits[0];
    const summary = `Add a comment to WIP ${w.wip} (${w.branch}): "${text}"`;
    return { result: `Proposal shown to the person for confirmation: ${summary}.`, proposal: { summary, token: sign({ u: au.user.id, a: "add_wip_comment", p: { key: w.key, wip: String(w.wip), text }, exp }) } };
  }
  return { result: "Unknown action." };
}

// ---------- dispatcher ----------

const MAX_RESULT = 30_000;

export async function runTool(
  name: string,
  input: Record<string, unknown>,
  au: AssistantUser,
  cache: Map<string, Row[]>,
): Promise<{ result: string; table?: ResultTable; proposal?: Proposal; isError?: boolean }> {
  try {
    if (name === "lookup") return { result: await lookup(String(input.input ?? "")) };
    if (name === "warranty_kpis") {
      const k = await warrantyKpis(au, input.from as string | undefined, input.to as string | undefined);
      const table = input.show_table && k.branches.length
        ? { title: `Warranty KPIs ${k.period}`, columns: Object.keys(k.branches[0]), rows: [...k.branches, { branch: "Total", ...k.totals }].map((r) => Object.values(r) as Cell[]) }
        : undefined;
      return { result: JSON.stringify(k), table };
    }
    if (name === "query_data") {
      const ds = String(input.dataset) as DatasetName;
      if (!(ds in DATASETS)) return { result: "Unknown dataset.", isError: true };
      const days = Number(input.days) || 30;
      const key = `${ds}:${days}`;
      if (!cache.has(key)) cache.set(key, await loadDataset(ds, au, days));
      const q = runQuery(cache.get(key)!, input);
      if ("error" in q) return { result: q.error!, isError: true };
      const table = input.show_table && q.rows.length
        ? { title: String(input.title ?? ds.replace(/_/g, " ")), columns: q.columns, rows: q.rows.map((r) => q.columns.map((c) => r[c] ?? null)) }
        : undefined;
      let text = JSON.stringify(q);
      if (text.length > MAX_RESULT) text = `${text.slice(0, MAX_RESULT)}… (cut: use group_by, filters or fewer fields)`;
      return { result: table ? `${text}\n(The full table is shown to the person.)` : text, table };
    }
    if (name === "propose_action") return await propose(au, String(input.action), (input.params as Record<string, unknown>) ?? {});
    return { result: `Unknown tool ${name}`, isError: true };
  } catch (e) {
    return { result: `The tool failed: ${e instanceof Error ? e.message : String(e)}`, isError: true };
  }
}
