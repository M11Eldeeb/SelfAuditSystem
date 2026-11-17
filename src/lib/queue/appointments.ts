import "server-only";
import ExcelJS from "exceljs";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchLatestMailSpreadsheet, getInvoicingConnection } from "@/lib/invoicing/gmail-reader";
import { JIAD_DEALER_CODE_SUFFIX_MAP } from "@/lib/parse-claims";
import { dealerCodeOf } from "@/lib/complaints/codes";
import { normalizeMobile } from "@/lib/queue/core";

/**
 * The DMS appointments sheet ("Appointment Detail ..."): a header row (COMPANY, COMPANY Name, ..., Wip No, Start Date,
 * Time In, Chassis Number, Customer Name, Telephone Number, ...), then per branch a "COMPANY: 2102" line and its rows.
 * The branch is the dealer code at the start of "COMPANY Name" (B7 MG Jed Madinah Rd -> Jeddah Madina Rd). "Time In" is
 * hours.minutes as a number (14.3 = 14:30, 8.45 = 08:45).
 */
const QUERY = `subject:(appointment) has:attachment newer_than:4d`;
const SUBJECT = /appointment/i;

const COLS = {
  company: ["company name"],
  status: ["app status", "status"],
  wip: ["wip no", "wip number", "wip"],
  date: ["start date", "date due in", "appointment date"],
  time: ["time in", "start time", "time"],
  vin: ["chassis number", "vin"],
  name: ["customer name"],
  phone: ["telephone number", "mobile", "phone"],
  description: ["description"],
  reception: ["service reception", "service advisor"],
  code: ["appointment code"],
  agent: ["agent name"],
} as const;

export type ParsedAppointment = {
  dealer: string;
  wip_no: string;
  appt_date: string; // YYYY-MM-DD
  appt_time: string | null; // HH:MM
  customer_name: string | null;
  mobile: string | null;
  vin: string | null;
  description: string | null;
  service_reception: string | null;
  status_text: string | null;
  appointment_code: string | null;
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function text(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.text != null) return String(o.text);
    if (o.result != null) return String(o.result);
    return "";
  }
  return String(v);
}

function dateOf(v: ExcelJS.CellValue): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = text(v).trim();
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

/** 14.3 -> 14:30, 8.45 -> 08:45, "9:15" -> 09:15, a time cell -> HH:MM; null when it is not a time of day. */
function timeOf(v: ExcelJS.CellValue): string | null {
  let h: number, m: number;
  if (v instanceof Date) {
    h = v.getUTCHours();
    m = v.getUTCMinutes();
  } else if (typeof v === "number") {
    if (v > 0 && v < 1) {
      const mins = Math.round(v * 24 * 60); // a fraction of a day (Excel time)
      h = Math.floor(mins / 60);
      m = mins % 60;
    } else {
      const [hh, mm = "0"] = v.toFixed(2).split(".");
      h = Number(hh);
      m = Number(mm);
    }
  } else {
    const s = text(v).trim();
    const hm = s.match(/^(\d{1,2})[:.](\d{1,2})/) ?? s.match(/^(\d{1,2})$/);
    if (!hm) return null;
    h = Number(hm[1]);
    m = Number((hm[2] ?? "0").padEnd(2, "0").slice(0, 2));
  }
  if (!(h >= 0 && h < 24 && m >= 0 && m < 60)) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export async function parseAppointmentsSheet(bytes: Buffer | ArrayBuffer): Promise<ParsedAppointment[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as ArrayBuffer);
  const out: ParsedAppointment[] = [];
  for (const ws of wb.worksheets) {
    let header = 0;
    const col: Partial<Record<keyof typeof COLS, number>> = {};
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      const values = row.values as ExcelJS.CellValue[];
      if (!header) {
        const cells = values.map((v) => norm(text(v)));
        if (!cells.includes("telephone number") && !cells.includes("wip no")) return;
        header = n;
        for (const [k, names] of Object.entries(COLS) as [keyof typeof COLS, readonly string[]][]) {
          const i = names.map((x) => cells.indexOf(x)).find((x) => x > 0);
          if (i) col[k] = i;
        }
        return;
      }
      const at = (k: keyof typeof COLS) => (col[k] ? values[col[k]!] : null);
      const company = text(at("company")).trim();
      if (/^company:/i.test(company)) return; // the "COMPANY: 2102" line before each branch
      const dealer = dealerCodeOf(company);
      const wip = text(at("wip")).replace(/\D/g, "").replace(/^0+/, "");
      const date = dateOf(at("date"));
      if (!dealer || !wip || !date) return;
      const clean = (v: ExcelJS.CellValue, n: number) => text(v).replace(/\s+/g, " ").trim().slice(0, n) || null;
      out.push({
        dealer,
        wip_no: wip,
        appt_date: date,
        appt_time: timeOf(at("time")),
        customer_name: clean(at("name"), 120),
        mobile: normalizeMobile(text(at("phone"))),
        vin: clean(at("vin"), 30)?.toUpperCase() ?? null,
        description: clean(at("description"), 300),
        service_reception: clean(at("reception"), 120),
        status_text: clean(at("status"), 40),
        appointment_code: clean(at("code"), 40),
      });
    });
    if (out.length) break;
  }
  return out;
}

/** Saves the rows (one per branch + WIP + date; a later file updates the same appointment). Returns rows saved. */
export async function saveAppointments(rows: ParsedAppointment[], source: "mail" | "upload"): Promise<{ saved: number; skipped: number; error?: string }> {
  const admin = createAdminClient();
  const { data: branches } = await admin.from("self_audit_branches").select("id, code");
  const idByCode = new Map((branches ?? []).map((b) => [b.code.toUpperCase(), b.id]));
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const full = [];
  let skipped = 0;
  for (const { dealer, ...r } of rows) {
    const branch_id = idByCode.get(JIAD_DEALER_CODE_SUFFIX_MAP[dealer] ?? "");
    const key = `${branch_id}|${r.wip_no}|${r.appt_date}`;
    if (!branch_id || seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    full.push({ ...r, branch_id, source, imported_at: now });
  }
  for (let i = 0; i < full.length; i += 500) {
    const { error } = await admin.from("self_audit_queue_appointments").upsert(full.slice(i, i + 500), { onConflict: "branch_id,wip_no,appt_date" });
    if (error) return { saved: i, skipped, error: error.message };
  }
  return { saved: full.length, skipped };
}

export type AppointmentImportResult =
  | { status: "imported"; fileName: string; receivedAt: string | null; rows: number; skipped: number }
  | { status: "unchanged"; receivedAt: string | null }
  | { status: "not-found" }
  | { status: "not-connected" }
  | { status: "error"; error: string };

/** The newest appointments e-mail, if it is new (or `force`). Used by the hourly job and the Check e-mail button. */
export async function importLatestAppointmentsMail(opts: { force?: boolean; userId?: string | null } = {}): Promise<AppointmentImportResult> {
  if (!(await getInvoicingConnection())) return { status: "not-connected" };
  const admin = createAdminClient();
  const { data: last } = await admin
    .from("self_audit_queue_appointment_imports")
    .select("gmail_message_id, received_at")
    .eq("source", "mail")
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  try {
    const mail = await fetchLatestMailSpreadsheet(QUERY, opts.force ? null : last?.gmail_message_id, (s) => SUBJECT.test(s));
    if (mail === "unchanged") return { status: "unchanged", receivedAt: last?.received_at ?? null };
    if (!mail) return { status: "not-found" };
    const rows = await parseAppointmentsSheet(mail.bytes);
    if (!rows.length) return { status: "error", error: `No appointments found in "${mail.fileName}" (expected the DMS Appointment Detail sheet).` };
    const r = await saveAppointments(rows, "mail");
    if (r.error) return { status: "error", error: r.error };
    await admin.from("self_audit_queue_appointment_imports").insert({
      source: "mail",
      gmail_message_id: mail.messageId,
      subject: mail.subject.slice(0, 300),
      received_at: mail.receivedAt,
      file_name: mail.fileName.slice(0, 200),
      rows: r.saved,
      imported_by: opts.userId ?? null,
    });
    return { status: "imported", fileName: mail.fileName, receivedAt: mail.receivedAt, rows: r.saved, skipped: r.skipped };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : "Import failed." };
  }
}
