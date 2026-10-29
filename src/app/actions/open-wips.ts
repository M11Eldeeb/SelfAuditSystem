"use server";

import ExcelJS from "exceljs";
import { requireAnyRole, requireAnyViewer, requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { importOpenWipsFromSheet, saveOpenWips, type OpenWipsImportResult } from "@/lib/open-wips/import";
import { parseOpenWips } from "@/lib/open-wips/parse";

const VIEWERS = ["officer", "branch_admin", "workshop_supervisor", "team_leader"] as const;

export type OpenWip = {
  key: string;
  branch: string;
  wip: string;
  dept: string | null;
  inOut: string | null;
  received: string | null;
  dueOut: string | null;
  firstSeen: string;
  invoiceable: number;
  parts: number;
  labour: number;
  account: string | null;
  status: string;
  partsStatus: string | null;
  vin: string | null;
  operator: string;
  registration: string | null;
  model: string | null;
  autolineNotes: string[];
  orderRef: string | null;
  saleType: string;
  takenHr: number | null;
  repeat: boolean;
  note: { text: string; by: string | null; at: string } | null;
};
export type OpenWipsData = {
  wips: OpenWip[];
  /** Daily open-WIP count per branch + operator. */
  daily: { day: string; branch: string; operator: string; count: number }[];
  lastImport: { at: string; source: string; rows: number; opened: number; closed: number; by: string | null } | null;
  scope: "all" | string;
  canEdit: boolean;
  canImport: boolean;
  today: string;
};

const todayKsa = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const NO_BRANCH = "00000000-0000-0000-0000-000000000000";

/** Officers: every branch. Warranty admins, workshop supervisors and team leaders: their own branch only. */
export async function getOpenWips(): Promise<OpenWipsData> {
  const user = await requireAnyViewer([...VIEWERS]);
  const admin = createAdminClient();
  const own = user.role === "officer" ? null : (user.branch_id ?? NO_BRANCH);
  const { data: branches } = await admin.from("self_audit_branches").select("id, name");
  const nameOf = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const branchName = (id: string | null, code: string) => (id && nameOf.get(id)) || code;

  const wipRows = [];
  for (let from = 0; ; from += 1000) {
    let q = admin.from("self_audit_open_wips").select("*").order("received", { ascending: true }).range(from, from + 999);
    if (own) q = q.eq("branch_id", own);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    wipRows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const keys = wipRows.map((w) => w.key);
  const notes = new Map<string, { note: string; updated_by_name: string | null; updated_at: string }>();
  for (let i = 0; i < keys.length; i += 300) {
    const { data } = await admin.from("self_audit_open_wip_notes").select("key, note, updated_by_name, updated_at").in("key", keys.slice(i, i + 300));
    for (const n of data ?? []) notes.set(n.key, n);
  }
  const daily: OpenWipsData["daily"] = [];
  const since = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
  for (let from = 0; ; from += 1000) {
    let q = admin.from("self_audit_open_wip_daily").select("day, dealer_code, branch_id, operator, count").gte("day", since).order("day").range(from, from + 999);
    if (own) q = q.eq("branch_id", own);
    const { data } = await q;
    for (const d of data ?? []) daily.push({ day: d.day, branch: branchName(d.branch_id, d.dealer_code), operator: d.operator, count: d.count });
    if ((data ?? []).length < 1000) break;
  }
  const { data: last } = await admin.from("self_audit_open_wip_imports").select("*").order("imported_at", { ascending: false }).limit(1).maybeSingle();

  return {
    wips: wipRows.map((w) => {
      const n = notes.get(w.key);
      return {
        key: w.key,
        branch: branchName(w.branch_id, w.dealer_code),
        wip: w.wip_no,
        dept: w.dept,
        inOut: w.in_out,
        received: w.received,
        dueOut: w.due_out,
        firstSeen: w.first_seen,
        invoiceable: Number(w.invoiceable ?? 0),
        parts: Number(w.wip_parts ?? 0),
        labour: Number(w.wip_labour ?? 0),
        account: w.account,
        status: w.wip_status ?? "No status",
        partsStatus: w.parts_status,
        vin: w.vin,
        operator: w.operator ?? "No operator",
        registration: w.registration,
        model: w.model,
        autolineNotes: [w.note1, w.note2, w.note3, w.note4].filter((x): x is string => !!x && !/^\?+[\s?]*$/.test(x)),
        orderRef: w.order_ref,
        saleType: w.sale_type ?? "Not set",
        takenHr: w.taken_hr == null ? null : Number(w.taken_hr),
        repeat: (w.repeat_repair ?? "").toUpperCase() === "Y",
        note: n ? { text: n.note, by: n.updated_by_name, at: n.updated_at } : null,
      };
    }),
    daily,
    lastImport: last ? { at: last.imported_at, source: last.source, rows: last.rows, opened: last.opened, closed: last.closed, by: last.imported_by_name } : null,
    scope: own ? branchName(own, "Your branch") : "all",
    canEdit: !user.viewOnly,
    canImport: user.role === "officer" && !user.viewOnly,
    today: todayKsa(),
  };
}

/** A note on one WIP (empty text removes it). Branch users only for their own branch's WIPs. */
export async function saveWipNote(key: string, text: string): Promise<{ error?: string; by?: string; at?: string }> {
  const user = await requireAnyRole([...VIEWERS]);
  const admin = createAdminClient();
  if (user.role !== "officer") {
    const { data } = await admin.from("self_audit_open_wips").select("branch_id").eq("key", key).maybeSingle();
    if (!data || data.branch_id !== user.branch_id) return { error: "This WIP is not in your branch." };
  }
  const note = text.trim().slice(0, 2000);
  const by = user.full_name ?? user.email;
  const at = new Date().toISOString();
  const { error } = note
    ? await admin.from("self_audit_open_wip_notes").upsert({ key, note, updated_by_name: by, updated_at: at })
    : await admin.from("self_audit_open_wip_notes").delete().eq("key", key);
  return error ? { error: error.message } : { by, at };
}

/** Officers: read the Google Sheet now. */
export async function refreshOpenWips(): Promise<OpenWipsImportResult> {
  const officer = await requireRole("officer");
  return importOpenWipsFromSheet(officer.full_name ?? officer.email);
}

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("result" in v) return cellValue(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    if ("error" in v) return null;
    return null;
  }
  return v;
}

/** Officers: the same report uploaded as an Excel (.xlsx) or CSV file - the FF3 tab, or the first one. */
export async function uploadOpenWips(form: FormData): Promise<OpenWipsImportResult> {
  const officer = await requireRole("officer");
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose a file." };
  if (file.size > 25 * 1024 * 1024) return { error: "The file must be under 25 MB." };
  let values: unknown[][];
  try {
    if (/\.csv$/i.test(file.name)) {
      const text = await file.text();
      values = text.split(/\r?\n/).map((line) => {
        const out: string[] = [];
        let cur = "";
        let q = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === '"' && line[i + 1] === '"' && q) {
            cur += '"';
            i++;
          } else if (c === '"') q = !q;
          else if (c === "," && !q) {
            out.push(cur);
            cur = "";
          } else cur += c;
        }
        out.push(cur);
        return out;
      });
    } else {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets.find((w) => w.name.trim().toUpperCase() === "FF3") ?? wb.worksheets[0];
      if (!ws) return { error: "The file has no sheets." };
      values = [];
      ws.eachRow({ includeEmpty: true }, (row) => values.push((row.values as ExcelJS.CellValue[]).slice(1).map(cellValue)));
    }
    return await saveOpenWips(parseOpenWips(values), "upload", file.name.slice(0, 200), officer.full_name ?? officer.email);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not read the file." };
  }
}
