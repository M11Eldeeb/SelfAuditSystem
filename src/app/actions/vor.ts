"use server";

import { requireAnyViewer } from "@/lib/auth";
import { loadVor } from "@/lib/vor/sheet";

export type VorField = "any" | "part" | "wip" | "dcs" | "ci" | "dn";
export type VorResult = {
  headers: string[];
  /** Index of the column for each search field / key detail (-1 when the file has no such column). */
  cols: Record<VorField | "description" | "qty" | "orderDate" | "eta" | "autoline" | "status", number>;
  /** The header names searched (a file can have more than one WIP or PO column - all are searched). */
  searched: string[];
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
  wip: [/branch\s*wip/i, /wip/i, /work\s*order/i, /\bw\.?o\b/i],
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

/** Every column holding numbers of this kind - all of them are searched. */
const ALL: Record<Exclude<VorField, "any">, RegExp> = {
  part: /part\s*(no|number|num|#|code)|^part$/i,
  wip: /wip|work\s*order|\bw\.?o\.?\b/i,
  dcs: /dcs|^purchase\s*order|\bpo\b/i,
  ci: /\bci\b|commercial\s*invoice/i,
  dn: /\bdn\b|delivery\s*note/i,
};
function searchColumns(headers: string[], cols: VorResult["cols"], field: VorField): number[] {
  const kinds = field === "any" ? (Object.keys(ALL) as Exclude<VorField, "any">[]) : [field];
  const out = new Set<number>();
  for (const k of kinds) {
    if (cols[k] >= 0) out.add(cols[k]);
    headers.forEach((h, i) => {
      if (ALL[k].test(h) && !(k === "dcs" && /autoline/i.test(h))) out.add(i);
    });
  }
  return [...out];
}

/** What was typed, plus the same without a branch prefix (HER-123456 -> 123456) and without leading zeros. */
function variants(v: string): string[] {
  const out = new Set([v]);
  const noPrefix = v.replace(/^[A-Z]{2,4}(?=\d)/, "");
  if (noPrefix.length >= 3) out.add(noPrefix);
  const noZeros = noPrefix.replace(/^0+(?=\d)/, "");
  if (noZeros.length >= 3) out.add(noZeros);
  return [...out];
}

/** Officers and warranty admins: VOR rows whose part number, WIP, DCS PO, CI or DN number matches. */
export async function searchVor(query: string, field: VorField): Promise<VorResult> {
  await requireAnyViewer(["officer", "branch_admin"]);
  const empty = (error: string): VorResult => ({ headers: [], cols: columns([]), searched: [], rows: [], total: 0, file: { name: "", sheet: "", modifiedTime: null, rows: 0 }, error });
  const q = norm(query);
  if (q.length < 3) return empty("Enter at least 3 characters.");
  let sheet;
  try {
    sheet = await loadVor();
  } catch (e) {
    return empty(e instanceof Error ? e.message : "Could not read the VOR file.");
  }
  const cols = columns(sheet.headers);
  const keyCols = searchColumns(sheet.headers, cols, field);
  const searched = keyCols.map((i) => sheet.headers[i]);
  if (!keyCols.length) return { ...empty(`The VOR file has no ${field.toUpperCase()} column.`), headers: sheet.headers, cols, searched };
  const qs = variants(q);
  // Exact match first (ignoring spaces, dashes, a branch prefix and leading zeros); otherwise the number contains what was typed.
  const exact = sheet.rows.filter((r) => keyCols.some((i) => r[i] && variants(norm(r[i])).some((c) => qs.includes(c))));
  const matched = exact.length ? exact : sheet.rows.filter((r) => keyCols.some((i) => r[i] && qs.some((v) => norm(r[i]).includes(v))));
  return {
    headers: sheet.headers,
    cols,
    searched,
    rows: matched.slice(0, 200),
    total: matched.length,
    file: { name: sheet.fileName, sheet: sheet.sheetName, modifiedTime: sheet.modifiedTime, rows: sheet.rows.length },
  };
}
