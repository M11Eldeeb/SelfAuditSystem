import { jsPDF } from "jspdf";
import { MG_LOGO_SRC } from "@/lib/mg-logo";
import { drawTable } from "@/lib/internal-audit-pdf";

export type SamplePreviewPdfRow = {
  claim_number: string;
  work_order_no: string | null;
  vin: string | null;
  branch_name: string;
  dealer_submit_date: string | null;
  labor_code: string | null;
  flag_score: number | null;
};

export type SamplePreviewPdfData = {
  branchLabel: string;
  dateFrom: string | null;
  dateTo: string | null;
  sampleMode: "flagged" | "random";
  maxPerPart: number | null;
  rows: SamplePreviewPdfRow[];
};

/** A preview-only listing of a proposed internal audit sample, before it's started. */
export function generateSamplePreviewPdf(data: SamplePreviewPdfData): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const tableW = pageW - 80;
  let y = 25;

  try {
    doc.addImage(MG_LOGO_SRC, "PNG", 40, y, 34, 34);
  } catch {
    // logo embed failure shouldn't block the rest of the document
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(20, 20, 20);
  doc.text("Internal Audit - Sample Preview", 84, y + 22);
  y += 46;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(90, 90, 90);
  [
    `Branch: ${data.branchLabel}`,
    `Submitted date range: ${data.dateFrom ?? "…"} to ${data.dateTo ?? "…"}`,
    `Sample mode: ${data.sampleMode === "flagged" ? "Highest audit flag first (risk-based)" : "Random"}`,
    `Max per labor code: ${data.maxPerPart ?? "No limit"}`,
    `Generated: ${new Date().toLocaleString()}`,
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
  doc.text(`Proposed sample: ${data.rows.length} claim${data.rows.length === 1 ? "" : "s"}`, 40, y);
  y += 16;

  const showFlag = data.sampleMode === "flagged";
  const headers = showFlag
    ? ["Claim #", "WO #", "VIN", "Branch", "Submit date", "Labor code", "Risk"]
    : ["Claim #", "WO #", "VIN", "Branch", "Submit date", "Labor code"];
  const flagCol = showFlag ? [45] : [];
  const remaining = tableW - 75 - 55 - 90 - 90 - 65 - flagCol.reduce((a, b) => a + b, 0);
  const colWidths = showFlag
    ? [75, 55, 90, remaining, 90, 65, 45]
    : [75, 55, 100, remaining + 45, 90, 65];

  const rows = data.rows.map((r) => {
    const base = [
      r.claim_number,
      r.work_order_no ?? "—",
      r.vin ?? "—",
      r.branch_name,
      r.dealer_submit_date ?? "—",
      r.labor_code ?? "—",
    ];
    return showFlag ? [...base, r.flag_score != null ? String(r.flag_score) : "—"] : base;
  });

  drawTable(doc, { startY: y + 6, colWidths, headers, rows, fontSize: 8.5 });

  doc.save(`Internal_Audit_Sample_Preview_${new Date().toISOString().slice(0, 10)}.pdf`);
}
