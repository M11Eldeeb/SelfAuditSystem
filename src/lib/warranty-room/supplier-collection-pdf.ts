import { jsPDF } from "jspdf";
import { MG_LOGO_SRC } from "@/lib/mg-logo";
import { drawTable } from "@/lib/internal-audit-pdf";

export type SupplierCollectionPdfPart = {
  claimNumber: string;
  workOrderNo: string | null;
  vin: string | null;
  partNo: string | null;
  partName: string | null;
  quantity: number | null;
  mainLaborName: string | null;
};

export type SupplierCollectionPdfData = {
  branchName: string;
  collectionDateLabel: string;
  parts: SupplierCollectionPdfPart[];
};

/** Same logo/table/signature-line pattern as internal-audit-pdf.ts, for the supplier hand-over sheet. */
export function generateSupplierCollectionPdf(data: SupplierCollectionPdfData): void {
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
  doc.text("Supplier Parts Collection", 84, y + 22);
  y += 46;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(90, 90, 90);
  [`Branch: ${data.branchName}`, `Collection date: ${data.collectionDateLabel}`].forEach((line) => {
    doc.text(line, 40, y);
    y += 14;
  });
  y += 8;

  doc.setDrawColor(220, 220, 220);
  doc.line(40, y, pageW - 40, y);
  y += 24;

  const rows = data.parts.map((p) => [
    p.claimNumber,
    p.workOrderNo ?? "",
    p.vin ?? "",
    p.partNo ?? "",
    p.partName ?? "",
    p.quantity != null ? String(p.quantity) : "",
    p.mainLaborName ?? "",
  ]);
  y = drawTable(doc, {
    startY: y,
    colWidths: [75, 65, 85, 60, tableW - 440, 35, 90],
    headers: ["Claim", "WO", "VIN", "Part No", "Part Name", "Qty", "Main Labor"],
    rows,
    fontSize: 8.5,
  });
  y += 40;

  if (y > 700) {
    doc.addPage();
    y = 50;
  }
  doc.setDrawColor(200, 200, 200);
  doc.line(40, y, 220, y);
  doc.line(320, y, 500, y);
  y += 12;
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text("Branch Representative", 40, y);
  doc.text("Supplier Representative", 320, y);
  y += 24;
  doc.setDrawColor(200, 200, 200);
  doc.text("Name: _______________________", 40, y);
  doc.text("Name: _______________________", 320, y);
  y += 20;
  doc.text("Signature: ___________________", 40, y);
  doc.text("Signature: ___________________", 320, y);

  doc.save(`Supplier_Parts_${data.branchName.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
