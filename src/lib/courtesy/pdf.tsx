import "server-only";
import React from "react";
import { readFile as readDisk } from "node:fs/promises";
import path from "node:path";
import { Document, Font, Image, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { TAJAWAL_BOLD, TAJAWAL_REGULAR } from "@/assets/fonts/tajawal-data";
import { BRAND, INK, LINE, MUTED, QR_BOX, brandLockup, qrBlock } from "@/lib/rejected-claims-logbook";
import { AUTHORIZATION_AR, AUTHORIZATION_EN, DAMAGE_KINDS, STATUS_LABEL, TERMS, fuelLabel } from "./agreements";
import type { Agreement } from "./agreements-server";

/**
 * The courtesy car agreement as a PDF, in the look of the portal's other sheets (technical inquiry, QC): the agreement
 * (repair order, customer, courtesy car), the 16 terms in English and Arabic with both signatures, the driving
 * authorization (Arabic, as the company form), the customer's licence, the walk-around drawing with the damage marks,
 * the photos of the car and, once returned, the return. A QR code opens the agreement in the portal.
 */

Font.register({
  family: "Tajawal",
  fonts: [
    { src: TAJAWAL_REGULAR, fontWeight: 400 },
    { src: TAJAWAL_BOLD, fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

const h = React.createElement;
const GREY = "#f3f4f6";
const stamp = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }) : "-");
const dateOnly = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: iso.length === 10 ? "UTC" : "Asia/Riyadh" }) : "-");

export type CourtesyPdfFiles = {
  customerSignature: Buffer | null;
  advisorSignature: Buffer | null;
  license: { data: Buffer; format: "png" | "jpg" } | null;
  photos: { data: Buffer; format: "png" | "jpg" }[];
  returnPhotos?: { data: Buffer; format: "png" | "jpg" }[];
  /** An old agreement printed from the other application's sheet: its other columns, and no walk-around / photo pages. */
  fromSheet?: { extra: { label: string; value: string }[] };
};

const page = { size: "A4" as const, style: { paddingTop: 26, paddingBottom: 56, paddingHorizontal: 40, fontFamily: "Tajawal", fontSize: 10, color: INK } };

/** A grey section bar: English title on the left, Arabic on the right. */
const bar = (en: string, ar: string) =>
  h(
    View,
    { style: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: GREY, borderLeftWidth: 3, borderLeftColor: INK, paddingVertical: 6, paddingHorizontal: 9, marginTop: 12, marginBottom: 8 } },
    h(Text, { style: { fontSize: 11, fontWeight: 700 } }, en),
    h(Text, { style: { fontSize: 11, fontWeight: 700, textAlign: "right" } }, ar)
  );

/** A field: small grey label over the value (bold). */
const field = (label: string, value: string | null | undefined, rtl = false) =>
  h(
    View,
    { style: { width: "50%", marginBottom: 6, paddingRight: 8, alignItems: rtl ? "flex-end" : "flex-start" } },
    h(Text, { style: { fontSize: 8, color: MUTED } }, label),
    h(Text, { style: { fontSize: 10.5, fontWeight: 700, textAlign: rtl ? "right" : "left" } }, value || "-")
  );
const fields = (...items: React.ReactNode[]) => h(View, { style: { flexDirection: "row", flexWrap: "wrap" } }, ...items);

function header(a: Agreement, url: string, title: string, sub: string) {
  return h(
    View,
    { style: { borderBottomWidth: 2, borderBottomColor: BRAND, paddingBottom: 12, marginBottom: 10 } },
    h(View, { style: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginHorizontal: -14 } }, brandLockup(QR_BOX), qrBlock(url, ["SCAN TO OPEN THE", "AGREEMENT"])),
    h(
      View,
      { style: { alignItems: "center", marginTop: -22 } },
      h(Text, { style: { fontSize: 9, color: MUTED, fontWeight: 700, textAlign: "center" } }, sub),
      h(Text, { style: { fontSize: 20, color: BRAND, fontWeight: 700, marginTop: 2, textAlign: "center" } }, title),
      h(View, { style: { width: 36, height: 2, backgroundColor: BRAND, marginTop: 6, marginBottom: 6 } }),
      h(Text, { style: { fontSize: 11, fontWeight: 700, textAlign: "center" } }, `Ref: ${a.ref}   ·   Date: ${dateOnly(a.handed_over_at ?? a.requested_at)}   ·   Status: ${STATUS_LABEL[a.status]}`)
    )
  );
}

const footer = (a: Agreement) =>
  h(
    View,
    { fixed: true, style: { position: "absolute", bottom: 22, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6 } },
    h(Text, { style: { fontSize: 8, color: MUTED } }, `${a.ref} - Jiad Modern Motors - 8002440390 - www.mg-sa.com`),
    h(Text, { style: { fontSize: 8, color: MUTED }, render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `Page ${pageNumber} of ${totalPages}` })
  );

const signature = (img: Buffer | null, caption: string, name: string | null) =>
  h(
    View,
    { style: { width: 200, alignItems: "center" } },
    img ? h(Image, { src: { data: img, format: "png" }, style: { height: 60, width: 180, objectFit: "contain" } }) : h(View, { style: { height: 60 } }),
    h(View, { style: { width: 180, borderTopWidth: 1, borderTopColor: INK, marginTop: 2 } }),
    h(Text, { style: { fontSize: 9, marginTop: 3, textAlign: "center" } }, caption),
    name ? h(Text, { style: { fontSize: 8, color: MUTED, textAlign: "center" } }, name) : null
  );

const DW = 515;
const DH = (515 * 787) / 1212;
/** The walk-around drawing with its numbered damage marks, and the list under it. */
function walkAround(diagram: Buffer, marks: { x: number; y: number; kind: string }[], none: string) {
  return h(
    View,
    { wrap: false },
    h(
      View,
      { style: { position: "relative", width: DW, height: DH } },
      h(Image, { src: { data: diagram, format: "jpg" }, style: { width: DW, height: DH } }),
      ...marks.map((d, i) =>
        h(
          View,
          { key: i, style: { position: "absolute", left: d.x * DW - 8, top: d.y * DH - 8, width: 16, height: 16, borderRadius: 8, backgroundColor: DAMAGE_KINDS.find((k) => k.id === d.kind)?.color ?? BRAND, alignItems: "center", justifyContent: "center" } },
          h(Text, { style: { fontSize: 8, color: "#ffffff", fontWeight: 700 } }, String(i + 1))
        )
      )
    ),
    h(Text, { style: { fontSize: 9, marginTop: 6 } }, marks.length ? marks.map((d, i) => `${i + 1}. ${DAMAGE_KINDS.find((k) => k.id === d.kind)?.en ?? d.kind}`).join("     ") : none)
  );
}
const photoGrid = (list: { data: Buffer; format: "png" | "jpg" }[]) => h(View, { style: { flexDirection: "row", flexWrap: "wrap", gap: 6 } }, ...list.map((p, i) => h(Image, { key: i, src: p, style: { width: 164, height: 123, objectFit: "cover" } })));

export async function courtesyPdf(a: Agreement, branchName: string, url: string, files: CourtesyPdfFiles): Promise<Buffer> {
  const diagram = await readDisk(path.join(process.cwd(), "public", "courtesy", "walkaround.jpg"));
  const car = [a.vehicle_label].filter(Boolean).join(" ");
  
  const doc = h(
    Document,
    { title: `Courtesy car agreement ${a.ref}`, author: "MG Warranty Management", subject: "Courtesy Car Agreement" },
    // ---- 1. The agreement
    h(
      Page,
      page,
      header(a, url, "COURTESY CAR AGREEMENT", "JIAD MODERN MOTORS - MG AFTER-SALES"),
      bar("Repair Order Information", "بيانات أمر العمل"),
      fields(
        field("Service Advisor", a.handed_over_by_name ?? a.advisor_name),
        field("Branch", branchName),
        field("WIP number", a.wip_no),
        field("Customer's car - plate", a.customer_plate),
        field("Customer's car - VIN", a.customer_vin),
        field("Notes", a.notes)
      ),
      bar("Customer Information", "بيانات العميل"),
      fields(
        field("Customer Name", a.customer_name),
        field("Phone Number", a.phone),
        field("ID / Iqama Number", a.id_number),
        field("Date of Birth", dateOnly(a.birth_date)),
        field("Nationality", a.nationality),
        field("Terms accepted", stamp(a.terms_accepted_at))
      ),
      bar("Courtesy Car Information", "بيانات المركبة البديلة"),
      fields(
        field("Assigned Vehicle", car),
        field("Fuel Level at Checkout", fuelLabel(a.fuel_out)),
        field("Mileage Out", a.mileage_out != null ? `${a.mileage_out.toLocaleString("en-US")} km` : null),
        field("Date & Time Out", stamp(a.handed_over_at)),
        field("Agreement Expiry", stamp(a.expires_at)),
        field("Damages at checkout", files.fromSheet ? "Recorded in the other application" : a.damages?.length ? `${a.damages.length} marked - see the walk-around page` : "None marked")
      ),
      a.status === "closed"
        ? h(
            View,
            null,
            bar("Return", "إعادة المركبة"),
            fields(
              field("Date & Time In", stamp(a.returned_at)),
              field("Received by", a.returned_by_name),
              field("Mileage In", a.mileage_in != null ? `${a.mileage_in.toLocaleString("en-US")} km` : null),
              field("Fuel Level at Return", fuelLabel(a.fuel_in)),
              field("Distance driven", a.mileage_in != null && a.mileage_out != null ? `${(a.mileage_in - a.mileage_out).toLocaleString("en-US")} km` : null),
              field("Return note", a.return_note)
            )
          )
        : null,
      files.fromSheet
        ? h(
            View,
            null,
            bar("More from the other application", "بيانات إضافية"),
            fields(...files.fromSheet.extra.map((x) => field(x.label, x.value))),
            h(Text, { style: { fontSize: 8.5, color: MUTED, marginTop: 6 } }, "Printed from the record of the other application (courtesy cars sheet). The agreement was signed there.")
          )
        : null,
      footer(a)
    ),
    // ---- 2. Terms and conditions, both signatures
    h(
      Page,
      page,
      bar("Terms and Conditions", "الشروط والأحكام"),
      ...TERMS.map((t, i) =>
        h(
          View,
          { key: i, wrap: false, style: { flexDirection: "row", borderBottomWidth: i === TERMS.length - 1 ? 0 : 0.5, borderBottomColor: LINE, paddingVertical: 4 } },
          h(Text, { style: { width: "50%", paddingRight: 8, fontSize: 8, lineHeight: 1.35, textAlign: "left" } }, `${i + 1}- ${t.en}`),
          h(
            View,
            { style: { width: "50%", paddingLeft: 8, flexDirection: "row-reverse" } },
            h(Text, { style: { width: 14, fontSize: 8.5, fontWeight: 700, textAlign: "right" } }, `${i + 1}-`),
            h(Text, { style: { flex: 1, fontSize: 8.5, lineHeight: 1.45, textAlign: "right" } }, t.ar)
          )
        )
      ),
      h(
        View,
        { wrap: false, style: { flexDirection: "row", justifyContent: "space-between", marginTop: 18 } },
        signature(files.customerSignature, "Customer Signature / توقيع العميل", a.customer_name),
        signature(files.advisorSignature, "Authorized MG Signatory / توقيع الشركة", a.handed_over_by_name)
      ),
      footer(a)
    ),
    // ---- 3. Driving authorization (Arabic, as the company form)
    h(
      Page,
      page,
      header(a, url, "تفويض قيادة مركبة", "DRIVING AUTHORIZATION"),
      bar("Customer Information", "بيانات العميل"),
      fields(field("رقم الهوية / الإقامة", a.id_number, true), field("اسم العميل", a.customer_name, true), field("رقم الجوال", a.phone, true), field("الجنسية", a.nationality, true)),
      bar("Courtesy Car Information", "بيانات المركبة البديلة"),
      fields(
        field("المركبة البديلة", car, true),
        field("مستوى الوقود", fuelLabel(a.fuel_out), true),
        field("ممشى المركبة", a.mileage_out != null ? `${a.mileage_out.toLocaleString("en-US")} km` : null, true),
        field("تاريخ انتهاء التفويض", stamp(a.expires_at), true)
      ),
      h(
        View,
        { style: { borderWidth: 1, borderColor: LINE, backgroundColor: "#fafafa", padding: 12, marginTop: 12 } },
        h(Text, { style: { fontSize: 10, lineHeight: 1.6, textAlign: "right" } }, AUTHORIZATION_AR),
        h(Text, { style: { fontSize: 8.5, lineHeight: 1.4, color: MUTED, marginTop: 6 } }, AUTHORIZATION_EN)
      ),
      h(
        View,
        { style: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 26 } },
        h(View, { style: { width: 140, height: 80, borderWidth: 1, borderColor: LINE, borderStyle: "dashed", alignItems: "center", justifyContent: "center" } }, h(Text, { style: { fontSize: 10, color: MUTED } }, "الختم")),
        signature(files.advisorSignature, "توقيع المفوض من الشركة / Authorized signatory", a.handed_over_by_name)
      ),
      h(Text, { style: { fontSize: 18, fontWeight: 700, textAlign: "center", marginTop: 36 } }, "8002440390 :الرقم المجاني"),
      h(Text, { style: { fontSize: 10, textAlign: "center", marginTop: 4 } }, "WWW.MG-SA.COM"),
      footer(a)
    ),
    // ---- 4. Licence, walk-around, photos (not for an old agreement of the other application)
    files.fromSheet ? null : h(
      Page,
      page,
      files.license
        ? h(View, null, bar("Customer Licence", "رخصة العميل"), h(Image, { src: files.license, style: { maxHeight: 250, objectFit: "contain", alignSelf: "flex-start" } }))
        : null,
      bar("Courtesy Car Walk-Around - Checkout", "فحص السيارة البديلة - عند التسليم"),
      walkAround(diagram, a.damages ?? [], "No damage marked at checkout."),
      files.photos.length ? h(View, { wrap: true }, bar("Photos at Checkout", "صور السيارة عند التسليم"), photoGrid(files.photos)) : null,
      footer(a)
    ),
    // ---- 5. The return: new damages and photos
    a.status === "closed" && !files.fromSheet
      ? h(
          Page,
          page,
          bar("Courtesy Car Walk-Around - Return", "فحص السيارة البديلة - عند الإعادة"),
          fields(
            field("Date & Time In", stamp(a.returned_at)),
            field("Received by", a.returned_by_name),
            field("Mileage In", a.mileage_in != null ? `${a.mileage_in.toLocaleString("en-US")} km` : null),
            field("Fuel Level at Return", fuelLabel(a.fuel_in))
          ),
          walkAround(diagram, a.return_damages ?? [], "No new damage marked at return."),
          a.return_note ? h(Text, { style: { fontSize: 9.5, marginTop: 6 } }, `Note: ${a.return_note}`) : null,
          files.returnPhotos?.length ? h(View, { wrap: true }, bar("Photos at Return", "صور السيارة عند الإعادة"), photoGrid(files.returnPhotos)) : null,
          footer(a)
        )
      : null
  );
  return renderToBuffer(doc);
}
