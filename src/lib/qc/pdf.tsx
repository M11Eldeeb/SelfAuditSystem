import "server-only";
import React from "react";
import { Document, Font, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { TAJAWAL_BOLD, TAJAWAL_REGULAR } from "@/assets/fonts/tajawal-data";
import { BRAND, INK, LINE, MUTED, QR_BOX, align, brandLockup, qrBlock } from "@/lib/rejected-claims-logbook";
import { purposeLabel, repairTypeLabel } from "@/lib/qc/constants";
import type { QcDetail } from "@/lib/qc/server";

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
  const status = qc.status === "passed" ? `Passed${qc.attempts > 1 ? ` at test ${qc.attempts}` : " at the first test"}` : "Failed - waiting for a retest";

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
          h(Text, { style: { fontSize: 10, color: qc.status === "passed" ? "#047857" : BRAND, marginTop: 2, fontWeight: 700, textAlign: "center" } }, `${qc.branch} - ${status}`)
        )
      ),
      h(
        View,
        { style: { marginBottom: 12 } },
        row("WIP number", qc.wip_no),
        row("Vehicle model", qc.model),
        row("Odometer IN", km(qc.odometer_in)),
        row("Final odometer", km(qc.final_odometer)),
        row("Purpose", purposeLabel(qc.purpose)),
        row("Repair type", repairTypeLabel(qc.repair_type)),
        row("Team leader", qc.team_leader),
        row("Service advisor", qc.service_advisor),
        row("Quality controller", qc.controller_name),
        row("Recorded", stamp(qc.created_at)),
        row("Passed", qc.passed_at ? stamp(qc.passed_at) : null)
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
            style: { borderLeftWidth: 3, borderLeftColor: t.result === "pass" ? "#059669" : BRAND, paddingLeft: 10, paddingBottom: 8, marginBottom: i === qc.tests.length - 1 ? 0 : 10 },
          },
          h(Text, { style: { fontSize: 11, fontWeight: 700, color: t.result === "pass" ? "#047857" : BRAND } }, `Test ${t.attempt} - ${t.result === "pass" ? "PASS" : "FAIL"}`),
          t.comment ? h(Text, { style: { fontSize: 10.5, lineHeight: 1.5, marginTop: 3, textAlign: align(t.comment) } }, t.comment) : null,
          h(Text, { style: { fontSize: 9, color: MUTED, marginTop: 4 } }, `Technician(s): ${t.technicians.map((x) => x.name).join(", ") || "-"}${t.finalOdometer != null ? `   ·   Final odometer: ${km(t.finalOdometer)}` : ""}`),
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
    )
  );
}

export async function renderQcReport(qc: QcDetail): Promise<Uint8Array> {
  const buffer = await renderToBuffer(qcDocument(qc) as Parameters<typeof renderToBuffer>[0]);
  return new Uint8Array(buffer);
}
