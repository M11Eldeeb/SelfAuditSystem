import { jsPDF } from "jspdf";
import { MG_LOGO_SRC } from "@/lib/mg-logo";

export type InternalAuditPdfData = {
  branchName: string;
  auditDateLabel: string;
  auditorName: string;
  managerName: string;
  overallScore: number;
  departmentScores: { label: string; pct: number | null }[];
  checkpointScores: { departmentLabel: string; label: string; pct: number | null }[];
  departmentRemarks: { label: string; text: string }[];
  recommendations: { dept: string; checkpoint: string; pct: number; text: string }[];
  claimNotes: { vin: string; claimNumber: string; note: string }[];
  closingStatement: string;
};

const NA = "N/A";

export function drawTable(
  doc: jsPDF,
  {
    startY,
    x = 40,
    colWidths,
    headers,
    rows,
    fontSize = 9,
    pageBottom = 780,
  }: { startY: number; x?: number; colWidths: number[]; headers: string[]; rows: string[][]; fontSize?: number; pageBottom?: number }
): number {
  let y = startY;
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);

  function drawHeaderRow() {
    const h = fontSize + 10;
    doc.setFillColor(228, 0, 43);
    doc.rect(x, y, tableWidth, h, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(fontSize);
    doc.setTextColor(255, 255, 255);
    let cx = x;
    headers.forEach((hd, i) => {
      doc.text(String(hd), cx + 5, y + h - 6);
      cx += colWidths[i];
    });
    y += h;
  }

  drawHeaderRow();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(fontSize);
  rows.forEach((row, ri) => {
    const wrapped = row.map((cell, ci) => doc.splitTextToSize(String(cell), colWidths[ci] - 10));
    const lineCount = Math.max(...wrapped.map((w) => w.length), 1);
    const rowH = Math.max(fontSize + 10, lineCount * (fontSize + 3) + 8);
    if (y + rowH > pageBottom) {
      doc.addPage();
      y = 50;
      drawHeaderRow();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(fontSize);
    }
    if (ri % 2 === 1) {
      doc.setFillColor(245, 245, 245);
      doc.rect(x, y, tableWidth, rowH, "F");
    }
    doc.setTextColor(40, 40, 40);
    let cx = x;
    wrapped.forEach((lines, ci) => {
      doc.text(lines, cx + 5, y + fontSize + 3);
      cx += colWidths[ci];
    });
    doc.setDrawColor(225, 225, 225);
    doc.line(x, y + rowH, x + tableWidth, y + rowH);
    y += rowH;
  });
  return y;
}

/** Ported from warranty_audit_app.html's generatePDF(). */
export function generateInternalAuditPdf(data: InternalAuditPdfData): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const tableW = pageW - 80;
  let y = 25;

  try {
    doc.addImage(MG_LOGO_SRC, "PNG", 40, y, 34, 34);
  } catch {
    // logo embed failure shouldn't block the rest of the report
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(20, 20, 20);
  doc.text("MG Warranty Claims Audit Report", 84, y + 22);
  y += 46;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(90, 90, 90);
  [
    `Branch: ${data.branchName}`,
    `Audit date: ${data.auditDateLabel}`,
    `Auditor: ${data.auditorName || NA}`,
    `Service manager: ${data.managerName || NA}`,
  ].forEach((line) => {
    doc.text(line, 40, y);
    y += 14;
  });
  y += 8;

  doc.setDrawColor(220, 220, 220);
  doc.line(40, y, pageW - 40, y);
  y += 24;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(20, 20, 20);
  doc.text(`Overall score: ${data.overallScore}%`, 40, y);
  y += 16;

  const deptRows = data.departmentScores.map((d) => [d.label, d.pct == null ? NA : `${d.pct}%`]);
  y = drawTable(doc, { startY: y, colWidths: [tableW - 150, 150], headers: ["Department", "Score"], rows: deptRows, fontSize: 9.5 });
  y += 20;

  if (y > 650) {
    doc.addPage();
    y = 50;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  doc.text("Checkpoint detail", 40, y);
  y += 10;
  const cpRows = data.checkpointScores.map((c) => [c.departmentLabel, c.label, c.pct == null ? NA : `${c.pct}%`]);
  y = drawTable(doc, {
    startY: y + 6,
    colWidths: [110, tableW - 260, 150],
    headers: ["Department", "Checkpoint", "Score"],
    rows: cpRows,
    fontSize: 8.5,
  });
  y += 20;

  if (data.departmentRemarks.length) {
    if (y > 680) {
      doc.addPage();
      y = 50;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(20, 20, 20);
    doc.text("Auditor remarks", 40, y);
    y += 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(70, 70, 70);
    data.departmentRemarks.forEach(({ label, text }) => {
      if (y > 760) {
        doc.addPage();
        y = 50;
      }
      doc.setFont("helvetica", "bold");
      doc.setTextColor(20, 20, 20);
      doc.text(label + ":", 40, y);
      y += 13;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(70, 70, 70);
      const lines = doc.splitTextToSize(text, pageW - 80);
      doc.text(lines, 40, y);
      y += lines.length * 12 + 10;
    });
    y += 10;
  }

  if (y > 650) {
    doc.addPage();
    y = 50;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  doc.text("Recommendations", 40, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(60, 60, 60);
  if (!data.recommendations.length) {
    doc.text("No open findings below the 80% threshold.", 40, y);
    y += 16;
  } else {
    data.recommendations.forEach((s) => {
      if (y > 760) {
        doc.addPage();
        y = 50;
      }
      doc.setFont("helvetica", "bold");
      doc.setTextColor(20, 20, 20);
      doc.text(`${s.dept} - ${s.checkpoint} (${s.pct}%)`, 40, y);
      y += 13;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(70, 70, 70);
      const lines = doc.splitTextToSize(s.text, pageW - 80);
      doc.text(lines, 40, y);
      y += lines.length * 12 + 10;
    });
  }

  if (data.claimNotes.length) {
    if (y > 650) {
      doc.addPage();
      y = 50;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(20, 20, 20);
    doc.text("Per-claim notes", 40, y);
    y += 10;
    const noteRows = data.claimNotes.map((n) => [n.vin, n.claimNumber, n.note]);
    y = drawTable(doc, {
      startY: y + 6,
      colWidths: [110, 110, tableW - 220],
      headers: ["VIN", "Claim", "Note"],
      rows: noteRows,
      fontSize: 8.5,
    });
    y += 20;
  }

  if (y > 700) {
    doc.addPage();
    y = 50;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(20, 20, 20);
  doc.text("Closing statement", 40, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(70, 70, 70);
  const closeLines = doc.splitTextToSize(data.closingStatement, pageW - 80);
  doc.text(closeLines, 40, y);
  y += closeLines.length * 12 + 30;

  if (y > 720) {
    doc.addPage();
    y = 50;
  }
  doc.setDrawColor(200, 200, 200);
  doc.line(40, y, 220, y);
  doc.line(320, y, 500, y);
  y += 12;
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text("Audit Conductor", 40, y);
  doc.text("Service Manager", 320, y);
  y += 12;
  doc.setTextColor(20, 20, 20);
  doc.text(data.auditorName || NA, 40, y);
  doc.text(data.managerName || NA, 320, y);

  doc.save(`Warranty_Audit_Report_${data.branchName.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
