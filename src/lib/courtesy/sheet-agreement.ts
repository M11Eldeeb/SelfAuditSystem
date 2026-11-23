import "server-only";
import { agreementOpen, type CourtesySheet } from "./sheet";
import type { Agreement } from "./agreements-server";

const norm = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();
const num = (v: string | undefined) => {
  const n = Number(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
/** A date-ish cell ("2026-11-23", "11/23/2026 10:38:43 AM") as ISO, or null. */
const iso = (v: string | undefined) => {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T00:00:00+03:00` : t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
/** "75%", "3/4", "6/8" -> percent. */
const fuel = (v: string | undefined) => {
  const t = String(v ?? "").trim();
  const f = t.match(/(\d+)\s*\/\s*(\d+)/);
  if (f) return Math.round((Number(f[1]) / Number(f[2])) * 100);
  const n = num(t);
  return n != null && n <= 100 ? n : null;
};

/**
 * One row of the other application's Replacement Agreements as an agreement the PDF can print: the known columns are
 * found by their header (customer, mobile, ID, birth, nationality, advisor, WIP, car, VIN, mileage, fuel, dates); every
 * other filled column is listed as it is.
 */
export function sheetRowAsAgreement(sheet: CourtesySheet, idx: number, branchId: string): { agreement: Agreement; extra: { label: string; value: string }[] } | null {
  const t = sheet.agreements;
  const r = t?.rows[idx];
  if (!t || !r) return null;
  const used = new Set<number>();
  const col = (...tests: RegExp[]) => {
    for (const re of tests) {
      const i = t.headers.findIndex((h, j) => !used.has(j) && re.test(norm(h)));
      if (i >= 0) {
        used.add(i);
        return r[i] ?? "";
      }
    }
    return "";
  };
  const c = sheet.cols.agreements;
  [c.agreement, c.plate, c.status, c.branch, c.out, c.back, c.customer, c.wip].forEach((i) => i >= 0 && used.add(i));
  const cell = (i: number) => (i >= 0 ? (r[i] ?? "") : "");

  const phone = col(/mobile|phone|جوال|tel/);
  const idNumber = col(/iqama|national id|id number|^id$|هوية|إقامة/);
  const birth = col(/birth|dob|ميلاد/);
  const nationality = col(/national(ity)?$|جنسية/);
  const advisor = col(/advisor|sa name|service adv|employee|staff|مستشار/);
  const model = col(/model|vehicle|car/);
  const vin = col(/vin|chassis|هيكل/);
  const kmOut = col(/(mileage|km|odometer).*out|out.*(mileage|km)|^mileage$|^km$/);
  const kmIn = col(/(mileage|km|odometer).*(in|return)|(in|return).*(mileage|km)/);
  const fuelOut = col(/fuel.*(out|check ?out)|^fuel/);
  const fuelIn = col(/fuel.*(in|return)/);
  const expiry = col(/expir|until|due|انتهاء/);
  const notes = col(/note|remark|comment|ملاحظ/);
  const custVin = col(/customer.*(vin|chassis)/);
  const custPlate = col(/customer.*plate/);

  const open = agreementOpen(r, c);
  const out = iso(cell(c.out));
  const back = iso(cell(c.back));
  const plate = cell(c.plate);
  const ref = cell(c.agreement) || `Sheet row ${idx + 2}`;
  const agreement: Agreement = {
    id: "",
    ref,
    branch_id: branchId,
    status: open ? "open" : "closed",
    lang: "en",
    customer_name: cell(c.customer) || "-",
    phone,
    id_number: idNumber,
    birth_date: /^\d{4}-\d{2}-\d{2}$/.test(birth.trim()) ? birth.trim() : (iso(birth) ? new Date(new Date(iso(birth)!).getTime() + 3 * 3_600_000).toISOString().slice(0, 10) : ""),
    nationality,
    customer_vin: custVin || null,
    customer_plate: custPlate || null,
    advisor_id: null,
    advisor_name: advisor || null,
    customer_signature: null,
    license_photo: null,
    terms_accepted_at: out,
    requested_at: out ?? new Date().toISOString(),
    vehicle_id: null,
    vehicle_label: [model, plate, vin].filter(Boolean).join("  ") || plate || null,
    vehicle_plate: plate || null,
    vehicle_model: model || null,
    vehicle_vin: vin || null,
    mileage_out: num(kmOut),
    fuel_out: fuel(fuelOut),
    damages: [],
    wip_no: cell(c.wip) || null,
    expires_at: iso(expiry),
    notes: notes || null,
    advisor_signature: null,
    photos: [],
    handed_over_at: out,
    handed_over_by: null,
    handed_over_by_name: advisor || null,
    mileage_in: num(kmIn),
    fuel_in: fuel(fuelIn),
    return_note: null,
    return_damages: [],
    return_photos: [],
    drive_folder_out: null,
    drive_folder_in: null,
    returned_at: back,
    returned_by_name: null,
    updated_at: new Date().toISOString(),
  };
  // Everything else the sheet holds for this agreement (pictures and long links left out).
  const extra = t.headers
    .map((h, i) => ({ label: h, value: (r[i] ?? "").trim() }))
    .filter((x, i) => !used.has(i) && x.value && x.value.length <= 160 && !/\.(png|jpe?g|webp)$/i.test(x.value) && !/^https?:\/\//i.test(x.value))
    .slice(0, 24);
  if (cell(c.status)) extra.unshift({ label: "Status (other application)", value: cell(c.status) });
  return { agreement, extra };
}
