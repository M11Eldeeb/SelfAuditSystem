"use server";

import ExcelJS from "exceljs";
import { requireAnyViewer, requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { importOpenWipsFromSheet, saveOpenWips, type OpenWipsImportResult } from "@/lib/open-wips/import";
import { parseOpenWips } from "@/lib/open-wips/parse";
import { agreementOpen, loadCourtesy, wipKey } from "@/lib/courtesy/sheet";
import { branchResolver } from "@/lib/courtesy/branches";
import { vorByWip, type VorLine } from "@/lib/vor/sheet";
import { loadSubDealerList, wipWorkOrder } from "@/lib/sub-dealer-wips";
import { JIAD_DEALER_CODE_SUFFIX_MAP } from "@/lib/parse-claims";

const VIEWERS = ["officer", "branch_admin", "workshop_supervisor", "team_leader", "service_advisor"] as const;

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
  /** The comment thread, oldest first. */
  comments: WipComment[];
  /** The courtesy car agreement on this WIP (from the courtesy cars sheet), if any. */
  courtesy: { plate: string | null; since: string | null; open: boolean; ref: string | null } | null;
  /** MOC / SAIC / CRM complaints on this car (by VIN) since a week before it came in. */
  complaints: { no: string | null; date: string | null; source: string; category: string | null; subcategory: string | null; valid: string | null; status: string | null; advisor: string | null; branch: string | null }[];
  /** VOR part orders on this WIP (from the VOR file). */
  vor: VorLine[];
  /** A Heraa WIP that is a warranty job card done for the sub-dealer (listed in the sub-dealer's Google Sheet). */
  subDealer: boolean;
};
export type WipComment = { id: string; body: string; by: string | null; byId: string | null; at: string };
export type OpenWipsData = {
  wips: OpenWip[];
  /** Daily open-WIP count per branch + operator. */
  daily: { day: string; branch: string; operator: string; count: number }[];
  lastImport: { at: string; source: string; rows: number; opened: number; closed: number; by: string | null } | null;
  scope: "all" | string;
  canEdit: boolean;
  /** The signed-in user (to delete his own comments). */
  userId: string;
  canImport: boolean;
  /** A manager (view only): no per-branch table. */
  managerView: boolean;
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
  const comments = new Map<string, WipComment[]>();
  for (let i = 0; i < keys.length; i += 300) {
    const { data } = await admin.from("self_audit_open_wip_comments").select("id, key, body, author_id, author_name, created_at").in("key", keys.slice(i, i + 300)).order("created_at");
    for (const c of data ?? []) comments.set(c.key, [...(comments.get(c.key) ?? []), { id: c.id, body: c.body, by: c.author_name, byId: c.author_id, at: c.created_at }]);
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

  // Courtesy cars: agreements by WIP number (and branch, when the sheet says it). A sheet problem never breaks this page.
  const courtesyByWip = new Map<string, { branchId: string | null; plate: string | null; since: string | null; open: boolean; ref: string | null }[]>();
  try {
    const sheet = await loadCourtesy();
    const c = sheet.cols.agreements;
    if (sheet.agreements && c.wip >= 0) {
      const resolve = await branchResolver();
      for (const r of sheet.agreements.rows) {
        const k = wipKey(r[c.wip] ?? "");
        if (!k) continue;
        const list = courtesyByWip.get(k) ?? [];
        list.push({
          branchId: c.branch >= 0 ? (resolve(r[c.branch])?.id ?? null) : null,
          plate: c.plate >= 0 ? r[c.plate] || null : null,
          since: c.out >= 0 ? r[c.out] || null : null,
          open: agreementOpen(r, c),
          ref: c.agreement >= 0 ? r[c.agreement] || null : null,
        });
        courtesyByWip.set(k, list);
      }
    }
  } catch {
    // no courtesy column data
  }
  // Complaints by VIN, and VOR orders by WIP - neither ever breaks this page.
  const vins = [...new Set(wipRows.map((w) => w.vin).filter((v): v is string => !!v && v.length >= 10))];
  const complaintsByVin = new Map<string, OpenWip["complaints"]>();
  const vorMapPromise = Promise.race([vorByWip(), new Promise<null>((r) => setTimeout(() => r(null), 15_000))]).catch(() => null);
  for (let i = 0; i < vins.length; i += 300) {
    const { data } = await admin.from("self_audit_complaints").select("vin, complaint_no, created_on, source, category, subcategory, validity, status, service_advisor, branch_label").in("vin", vins.slice(i, i + 300));
    for (const c of data ?? [])
      complaintsByVin.set(c.vin!, [...(complaintsByVin.get(c.vin!) ?? []), { no: c.complaint_no, date: c.created_on, source: c.source, category: c.category, subcategory: c.subcategory, valid: c.validity, status: c.status, advisor: c.service_advisor, branch: c.branch_label }]);
  }
  const vorMap = await vorMapPromise;
  const subDealerWips = await loadSubDealerList();
  const resolveBranch = await branchResolver().catch(() => null);
  /** VOR lines on this WIP: the same branch (when the file says) and ordered no earlier than a month before the car came in. */
  const vorFor = (wip: string, branchId: string | null, received: string | null) =>
    (vorMap?.get(wipNo(wip)) ?? []).filter((v) => {
      const b = v.branch && resolveBranch ? resolveBranch(v.branch) : null;
      const branchKnown = !!b;
      if (branchKnown && b!.id !== branchId) return false;
      const since = received ? new Date(Date.parse(received) - 30 * 86_400_000).toISOString().slice(0, 10) : null;
      if (v.orderDate && since) return v.orderDate >= since;
      return branchKnown;
    });
  const wipNo = (v: string) => v.toUpperCase().replace(/^[A-Z]{2,4}[-\s]*/, "").replace(/\D/g, "").replace(/^0+/, "");
  const complaintsFor = (vin: string | null, received: string | null) => {
    if (!vin) return [];
    const since = received ? new Date(Date.parse(received) - 7 * 86_400_000).toISOString().slice(0, 10) : null;
    return (complaintsByVin.get(vin) ?? []).filter((c) => !since || !c.date || c.date >= since).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  };

  const courtesyFor = (wip: string, branchId: string | null) => {
    const list = (courtesyByWip.get(wipKey(wip)) ?? []).filter((x) => !x.branchId || !branchId || x.branchId === branchId);
    const pick = list.find((x) => x.open) ?? list[list.length - 1];
    return pick ? { plate: pick.plate, since: pick.since, open: pick.open, ref: pick.ref } : null;
  };

  return {
    wips: wipRows.map((w) => {
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
        comments: comments.get(w.key) ?? [],
        courtesy: courtesyFor(w.wip_no, w.branch_id),
        complaints: complaintsFor(w.vin, w.received),
        vor: vorFor(w.wip_no, w.branch_id, w.received),
        subDealer: subDealerWips.match(wipWorkOrder(JIAD_DEALER_CODE_SUFFIX_MAP[w.dealer_code], w.wip_no), w.vin),
      };
    }),
    daily,
    lastImport: last ? { at: last.imported_at, source: last.source, rows: last.rows, opened: last.opened, closed: last.closed, by: last.imported_by_name } : null,
    scope: own ? branchName(own, "Your branch") : "all",
    canEdit: !user.viewOnly,
    userId: user.id,
    canImport: user.role === "officer" && !user.viewOnly,
    managerView: !!user.managerKind,
    today: todayKsa(),
  };
}

/** The WIP (and its branch) the user may comment on: officers any; branch users their own branch's. */
async function commentableWip(key: string) {
  const user = await requireAnyViewer([...VIEWERS]);
  if (user.role === "officer") return { user };
  const { data } = await createAdminClient().from("self_audit_open_wips").select("branch_id").eq("key", key).maybeSingle();
  if (!data || data.branch_id !== user.branch_id) return { error: "This WIP is not in your branch." as const };
  return { user };
}

/** Everyone who sees the WIP (view-only accounts too): adds a comment to its thread. */
export async function addWipComment(key: string, text: string): Promise<{ comment?: WipComment; error?: string }> {
  const r = await commentableWip(key);
  if ("error" in r) return { error: r.error };
  const body = text.trim().slice(0, 2000);
  if (!body) return { error: "Write a comment." };
  const name = r.user.full_name ?? r.user.email;
  const { data, error } = await createAdminClient().from("self_audit_open_wip_comments").insert({ key, body, author_id: r.user.id, author_name: name }).select("id, created_at").single();
  if (error || !data) return { error: error?.message ?? "Could not save the comment." };
  return { comment: { id: data.id, body, by: name, byId: r.user.id, at: data.created_at } };
}

/** The author (or an officer) removes a comment. */
export async function deleteWipComment(id: string): Promise<{ error?: string }> {
  const user = await requireAnyViewer([...VIEWERS]);
  const admin = createAdminClient();
  const { data: c } = await admin.from("self_audit_open_wip_comments").select("author_id").eq("id", id).maybeSingle();
  if (!c) return { error: "Comment not found." };
  if (c.author_id !== user.id && !(user.role === "officer" && !user.viewOnly)) return { error: "Only the author can remove this comment." };
  const { error } = await admin.from("self_audit_open_wip_comments").delete().eq("id", id);
  return error ? { error: error.message } : {};
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
