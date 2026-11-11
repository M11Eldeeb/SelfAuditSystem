import "server-only";
import React from "react";
import { Document, Font, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { TAJAWAL_BOLD, TAJAWAL_REGULAR } from "@/assets/fonts/tajawal-data";
import { BRAND, INK, LINE, MUTED, QR_BOX, align, brandLockup, qrBlock } from "@/lib/rejected-claims-logbook";
import { purposeLabel, repairTypeLabel } from "@/lib/qc/constants";
import type { QcDetail, QcTest } from "@/lib/qc/server";
import { BRAKE_MEASURES, WHEELS, sectionsFor, sheetTitle, type Mark } from "@/lib/qc/checklist";

/**
 * The QC case report: one PDF per QC, in the same look as the technical inquiry and rejected claim sheets - the vehicle
 * and job details, every test with its result, comment and signature (name, date and time), and a QR code that opens the
 * QC's Drive folder. Drawn on request, so it always shows the latest test.
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
const stamp = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });
const km = (n: number | null | undefined) => (n == null ? null : `${n.toLocaleString("en-US")} km`);

function qcDocument(qc: QcDetail) {
  const folderUrl = qc.drive_folder_id ? `https://drive.google.com/drive/folders/${qc.drive_folder_id}` : null;
  const filesOf = (testId: string) => qc.files.filter((f) => f.testId === testId);
  const status =
    qc.status === "passed" ? `Passed${qc.attempts > 1 ? ` at test ${qc.attempts}` : " at the first test"} - closed` : qc.status === "closed" ? "Closed as failed" : "Failed - waiting for a retest";

  const row = (name: string, value: string | null | undefined) =>
    value
      ? h(
          View,
          { key: name, style: { flexDirection: "row", marginBottom: 4 } },
          h(Text, { style: { width: 120, color: MUTED, fontSize: 9 } }, name),
          h(Text, { style: { flex: 1, fontWeight: 700, fontSize: 10, textAlign: align(value) } }, value)
        )
      : null;

  const block = (title: string, text: string | null | undefined) =>
    text
      ? h(
          View,
          { key: title, style: { borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 10, marginBottom: 10 } },
          h(Text, { style: { fontSize: 9, color: MUTED, marginBottom: 3 } }, title),
          h(Text, { style: { fontSize: 10.5, lineHeight: 1.5, textAlign: align(text) } }, text)
        )
      : null;

  return h(
    Document,
    { title: `Quality control ${qc.qc_no}`, author: "MG Warranty Management", subject: "Quality Control" },
    h(
      Page,
      { size: "A4", style: { paddingTop: 26, paddingBottom: 56, paddingHorizontal: 40, fontFamily: "Tajawal", fontSize: 10, color: INK } },
      h(
        View,
        { style: { borderBottomWidth: 2, borderBottomColor: BRAND, paddingBottom: 14, marginBottom: 16 } },
        h(
          View,
          { style: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginHorizontal: -14 } },
          brandLockup(QR_BOX),
          folderUrl ? qrBlock(folderUrl, ["SCAN TO OPEN THE", "DRIVE FOLDER"]) : h(View, { style: { width: 70 } })
        ),
        h(
          View,
          { style: { alignItems: "center", marginTop: -24 } },
          h(Text, { style: { fontSize: 9, color: MUTED, fontWeight: 700, letterSpacing: 1.5, textAlign: "center" } }, "QUALITY CONTROL"),
          h(Text, { style: { fontSize: 24, color: BRAND, fontWeight: 700, letterSpacing: 2, marginTop: 2, textAlign: "center" } }, "QC REPORT"),
          h(View, { style: { width: 36, height: 2, backgroundColor: BRAND, marginTop: 8, marginBottom: 8 } }),
          h(Text, { style: { fontSize: 17, fontWeight: 700, letterSpacing: 0.5, textAlign: "center" } }, `${qc.qc_no} - ${qc.wip_no}`),
          h(Text, { style: { fontSize: 10, color: qc.status === "passed" ? "#047857" : qc.status === "closed" ? MUTED : BRAND, marginTop: 2, fontWeight: 700, textAlign: "center" } }, `${qc.branch} - ${status}`)
        )
      ),
      h(
        View,
        { style: { marginBottom: 12 } },
        row("WIP number", qc.wip_no),
        row("VIN", qc.vin),
        row("Vehicle model", qc.model),
        row("Odometer IN", km(qc.odometer_in)),
        row("Current odometer", km(qc.final_odometer)),
        row("Purpose", purposeLabel(qc.purpose)),
        row("Repair type", repairTypeLabel(qc.repair_type)),
        row("Team leader", qc.team_leader),
        row("Service advisor", qc.service_advisor),
        row("Quality controller", qc.controller_name),
        row("Recorded", stamp(qc.created_at)),
        row("Passed", qc.passed_at ? stamp(qc.passed_at) : null),
        row("Closed", qc.closed_at ? stamp(qc.closed_at) : null)
      ),
      block("Replaced parts", qc.replaced_parts),
      block("Defect description", qc.defect_description),
      h(Text, { style: { fontSize: 12, fontWeight: 700, marginTop: 6, marginBottom: 8 } }, `Test history (${qc.tests.length})`),
      ...qc.tests.map((t, i) =>
        h(
          View,
          {
            key: t.id,
            wrap: false,
            style: { borderLeftWidth: 3, borderLeftColor: t.result === "pass" ? "#059669" : t.result === "close" ? MUTED : BRAND, paddingLeft: 10, paddingBottom: 8, marginBottom: i === qc.tests.length - 1 ? 0 : 10 },
          },
          h(Text, { style: { fontSize: 11, fontWeight: 700, color: t.result === "pass" ? "#047857" : t.result === "close" ? MUTED : BRAND } }, `Test ${t.attempt} - ${t.result === "pass" ? "PASS - CASE CLOSED" : t.result === "close" ? "CLOSED AS FAILED" : "FAIL"}`),
          t.comment ? h(Text, { style: { fontSize: 10.5, lineHeight: 1.5, marginTop: 3, textAlign: align(t.comment) } }, t.comment) : null,
          h(Text, { style: { fontSize: 9, color: MUTED, marginTop: 4 } }, `Technician(s): ${t.technicians.map((x) => x.name).join(", ") || "-"}${t.finalOdometer != null ? `   ·   Current odometer: ${km(t.finalOdometer)}` : ""}`),
          filesOf(t.id).length ? h(Text, { style: { fontSize: 8.5, color: MUTED, marginTop: 2 } }, `Files: ${filesOf(t.id).map((f) => f.name).join(", ")}`) : null,
          h(
            View,
            { style: { flexDirection: "row", marginTop: 5, borderTopWidth: 1, borderTopColor: LINE, borderTopStyle: "dashed", paddingTop: 4 } },
            h(Text, { style: { fontSize: 9, color: MUTED } }, "Signed: "),
            h(Text, { style: { fontSize: 9, fontWeight: 700 } }, t.by ?? "-"),
            h(Text, { style: { fontSize: 9, color: MUTED, marginLeft: 8 } }, stamp(t.at))
          )
        )
      ),
      h(
        View,
        { fixed: true, style: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6 } },
        h(Text, { style: { fontSize: 8, color: MUTED } }, `${qc.qc_no} - generated ${stamp(new Date().toISOString())}.`),
        h(Text, { style: { fontSize: 8, color: MUTED }, render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `Page ${pageNumber} of ${totalPages}` })
      )
    ),
    // One inspection sheet page per test that has one, as the paper sheet: every item with its G / I / R box ticked.
    ...qc.tests.filter((t) => t.checklist).map((t) => sheetPage(qc, t))
  );
}

const MARK_COLOR: Record<Mark, string> = { G: "#047857", I: "#b45309", R: BRAND, NA: MUTED };

function sheetPage(qc: QcDetail, t: QcTest) {
  const sheet = t.checklist!;
  const sections = sectionsFor(sheet.repairType);
  const box = (label: string, on: boolean, color: string) =>
    h(
      View,
      { key: label, style: { width: 13, height: 11, marginLeft: 2, borderWidth: 0.8, borderColor: on ? color : "#9ca3af", backgroundColor: on ? color : "#ffffff", alignItems: "center", justifyContent: "center" } },
      h(Text, { style: { fontSize: 6.5, fontWeight: 700, color: on ? "#ffffff" : "#6b7280" } }, label)
    );
  const itemRow = (label: string, marks: "GIR" | "GR", value: Mark | undefined, clarify?: string) =>
    h(
      View,
      { key: label, wrap: false, style: { flexDirection: "row", alignItems: "center", paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: LINE } },
      h(Text, { style: { flex: 1, fontSize: 8.5 } }, clarify ? `${label} - ${clarify}` : label),
      value === "NA" ? h(Text, { style: { fontSize: 7.5, color: MUTED } }, "Not equipped") : null,
      ...(marks === "GIR" ? (["G", "I", "R"] as const) : (["G", "R"] as const)).map((m) => box(m, value === m, MARK_COLOR[m]))
    );
  const sectionBlock = (sec: (typeof sections)[number]) =>
    h(
      View,
      { key: sec.id, wrap: false, style: { width: "48.5%", marginBottom: 8, borderWidth: 1, borderColor: LINE, borderRadius: 3 } },
      h(Text, { style: { fontSize: 9.5, fontWeight: 700, backgroundColor: "#f3f4f6", paddingVertical: 3, paddingHorizontal: 6 } }, sec.title),
      h(
        View,
        { style: { paddingHorizontal: 6, paddingVertical: 3 } },
        ...sec.items.map((i) => itemRow(i.label, i.marks, sheet.answers[i.id], sheet.clarify[i.id])),
        sec.extra === "wheels"
          ? h(
              View,
              { style: { flexDirection: "row", flexWrap: "wrap", marginTop: 4 } },
              ...WHEELS.map((w) =>
                h(Text, { key: w, style: { width: "50%", fontSize: 8, color: INK, marginBottom: 2 } }, `${w}: ${sheet.wheels[w]?.pressure || "--"} psi · ${sheet.wheels[w]?.torque || "--"} Nm`)
              )
            )
          : null,
        sec.extra === "brakes"
          ? h(
              View,
              { style: { flexDirection: "row", flexWrap: "wrap", marginTop: 4 } },
              ...BRAKE_MEASURES.map((b) => h(Text, { key: b.id, style: { width: "50%", fontSize: 8, marginBottom: 2 } }, `${b.label}: ${sheet.brakes[b.id] || "--"} mm`)),
              h(Text, { style: { width: "100%", fontSize: 8 } }, `Tire production date: ${sheet.tireDate || "--"}`)
            )
          : null,
        sheet.comments[sec.id] ? h(Text, { style: { fontSize: 8, color: MUTED, marginTop: 3, textAlign: align(sheet.comments[sec.id]) } }, `Comments: ${sheet.comments[sec.id]}`) : null
      )
    );
  const resultText = t.result === "pass" ? "PASS" : t.result === "close" ? "NOT PASS - CLOSED AS FAILED" : "NOT PASS";
  return h(
    Page,
    { key: `sheet-${t.id}`, size: "A4", style: { paddingTop: 22, paddingBottom: 48, paddingHorizontal: 30, fontFamily: "Tajawal", fontSize: 9, color: INK } },
    h(
      View,
      { style: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 2, borderBottomColor: BRAND, paddingBottom: 8, marginBottom: 8 } },
      h(View, { style: { width: 150 } }, h(Text, { style: { fontSize: 7.5, color: MUTED } }, "G = Good   I = Inspect   R = Repair / Replace")),
      brandLockup(38),
      h(
        View,
        { style: { width: 150, alignItems: "flex-end" } },
        h(Text, { style: { fontSize: 8.5 } }, `Date: ${stamp(t.at).split(",")[0]}`),
        h(Text, { style: { fontSize: 8.5 } }, `WIP: ${qc.wip_no}`),
        h(Text, { style: { fontSize: 8.5 } }, `Odometer: ${km(t.finalOdometer ?? qc.odometer_in) ?? "-"}`)
      )
    ),
    h(Text, { style: { fontSize: 15, fontWeight: 700, textAlign: "center", marginBottom: 2 } }, sheetTitle(sheet.repairType)),
    h(Text, { style: { fontSize: 9, color: MUTED, textAlign: "center", marginBottom: 8 } }, `${qc.qc_no} · Test ${t.attempt} · ${qc.model ?? ""}${qc.vin ? ` · VIN ${qc.vin}` : ""}`),
    h(View, { style: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" } }, ...sections.map(sectionBlock)),
    h(
      View,
      { wrap: false, style: { flexDirection: "row", borderWidth: 1, borderColor: LINE, borderRadius: 3, marginTop: 2 } },
      h(
        View,
        { style: { width: 130, padding: 6, borderRightWidth: 1, borderRightColor: LINE } },
        h(Text, { style: { fontSize: 8, color: MUTED } }, "Result"),
        h(Text, { style: { fontSize: 11, fontWeight: 700, color: t.result === "pass" ? "#047857" : BRAND, marginTop: 2 } }, resultText)
      ),
      h(
        View,
        { style: { flex: 1, padding: 6, borderRightWidth: 1, borderRightColor: LINE } },
        h(Text, { style: { fontSize: 8, color: MUTED } }, t.result === "pass" ? "General comments" : "Reason"),
        h(Text, { style: { fontSize: 9, marginTop: 2, textAlign: align(t.comment ?? "") } }, t.comment || "-")
      ),
      h(
        View,
        { style: { width: 140, padding: 6 } },
        h(Text, { style: { fontSize: 8, color: MUTED } }, "Quality inspector signature"),
        h(Text, { style: { fontSize: 9.5, fontWeight: 700, marginTop: 2 } }, t.by ?? "-"),
        h(Text, { style: { fontSize: 8, color: MUTED } }, stamp(t.at))
      )
    ),
    h(
      View,
      { fixed: true, style: { position: "absolute", bottom: 20, left: 30, right: 30, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: LINE, paddingTop: 5 } },
      h(Text, { style: { fontSize: 7.5, color: MUTED } }, `${qc.qc_no} - inspection sheet, test ${t.attempt}.`),
      h(Text, { style: { fontSize: 7.5, color: MUTED }, render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `Page ${pageNumber} of ${totalPages}` })
    )
  );
}

export async function renderQcReport(qc: QcDetail): Promise<Uint8Array> {
  const buffer = await renderToBuffer(qcDocument(qc) as Parameters<typeof renderToBuffer>[0]);
  return new Uint8Array(buffer);
}
