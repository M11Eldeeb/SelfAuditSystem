"use server";

import { requireAnyViewer } from "@/lib/auth";
import { loadVor } from "@/lib/vor/sheet";

export type VorField = "any" | "part" | "wip" | "dcs" | "ci" | "dn";
export type VorResult = {
  headers: string[];
  /** Index of the column for each search field / key detail (-1 when the file has no such column). */
  cols: Record<VorField | "description" | "qty" | "orderDate" | "eta" | "autoline" | "status", number>;
  rows: string[][];
  total: number;
  file: { name: string; sheet: string; modifiedTime: string | null; rows: number };
  error?: string;
};

const norm = (v: string) => v.toUpperCase().replace(/[\s\-_/.]/g, "");

/** Column finders by header name. */
const FIND: Record<keyof VorResult["cols"], RegExp[]> = {
  any: [],
  part: [/^part\s*(no|number|num|#|code)\.?$/i, /part\s*(no|number|#)/i, /^part$/i, /item\s*(no|code)/i],
  wip: [/wip/i, /work\s*order/i, /\bwo\b/i],
  dcs: [/dcs/i, /^purchase\s*order/i, /\bpo\b(?!.*autoline)/i],
  ci: [/\bci\b/i, /commercial\s*invoice/i],
  dn: [/\bdn\b/i, /delivery\s*note/i],
  description: [/desc/i, /part\s*name/i],
  qty: [/order(ed)?\s*q(ty|uantity)/i, /\bq(ty|uantity)\b/i],
  orderDate: [/order\s*(place|placed|placing)?\s*date/i, /date.*order/i],
  eta: [/eta.*pdc/i, /pdc.*eta/i, /\beta\b/i],
  autoline: [/autoline/i],
  status: [/status/i, /remark/i],
};

function columns(headers: string[]): VorResult["cols"] {
  const used = new Set<number>();
  const out = {} as VorResult["cols"];
  for (const key of Object.keys(FIND) as (keyof VorResult["cols"])[]) {
    let idx = -1;
    for (const re of FIND[key]) {
      idx = headers.findIndex((h, i) => !used.has(i) && re.test(h));
      if (idx >= 0) break;
    }
    // Autoline PO must not be taken as the DCS purchase order.
    if (key === "dcs" && idx >= 0 && /autoline/i.test(headers[idx])) idx = -1;
    out[key] = idx;
    if (idx >= 0 && key !== "any") used.add(idx);
  }
  return out;
}

/** Officers and warranty admins: VOR rows whose part number, WIP, DCS PO, CI or DN number matches. */
export async function searchVor(query: string, field: VorField): Promise<VorResult> {
  await requireAnyViewer(["officer", "branch_admin"]);
  const empty = (error: string): VorResult => ({ headers: [], cols: columns([]), rows: [], total: 0, file: { name: "", sheet: "", modifiedTime: null, rows: 0 }, error });
  const q = norm(query);
  if (q.length < 3) return empty("Enter at least 3 characters.");
  let sheet;
  try {
    sheet = await loadVor();
  } catch (e) {
    return empty(e instanceof Error ? e.message : "Could not read the VOR file.");
  }
  const cols = columns(sheet.headers);
  const keyCols = (field === "any" ? (["part", "wip", "dcs", "ci", "dn"] as const).map((k) => cols[k]) : [cols[field]]).filter((i) => i >= 0);
  if (!keyCols.length) return { ...empty(`The VOR file has no ${field.toUpperCase()} column.`), headers: sheet.headers, cols };
  // Exact match first; partial match (the number contains what was typed) when nothing matches exactly.
  const exact = sheet.rows.filter((r) => keyCols.some((i) => norm(r[i] ?? "") === q));
  const matched = exact.length ? exact : sheet.rows.filter((r) => keyCols.some((i) => norm(r[i] ?? "").includes(q)));
  return {
    headers: sheet.headers,
    cols,
    rows: matched.slice(0, 200),
    total: matched.length,
    file: { name: sheet.fileName, sheet: sheet.sheetName, modifiedTime: sheet.modifiedTime, rows: sheet.rows.length },
  };
}
