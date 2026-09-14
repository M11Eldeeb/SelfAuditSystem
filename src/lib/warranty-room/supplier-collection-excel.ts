// No "server-only" here on purpose - runs in the browser, same as
// src/lib/internal-audit-sample-excel.ts.
import ExcelJS from "exceljs";

export type SupplierCollectionExcelRow = {
  claim_number: string;
  work_order_no: string | null;
  vin: string | null;
  part_no: string | null;
  part_name: string | null;
  quantity: number | null;
  main_labor_name: string | null;
  planned_pickup_date: string | null;
  raw_row: Record<string, unknown> | null;
};

/**
 * Shows every column from the originally uploaded Supplier Parts sheet, in
 * first-seen order, so the branch's download matches what the officer
 * uploaded. A claim can have more than one part on file though (a row here
 * is already expanded to one real part - see upsertSupplierPartsChunk),
 * which may differ from the sheet's own single "Main Part" column, so the
 * actual part to collect is called out in its own columns rather than
 * silently overwriting the original one.
 */
export async function generateSupplierCollectionExcel(branchName: string, rows: SupplierCollectionExcelRow[]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Supplier Parts");

  const originalHeaders: string[] = [];
  const seen = new Set<string>();
  rows.forEach((r) => {
    Object.keys(r.raw_row ?? {}).forEach((h) => {
      if (h.trim() && !seen.has(h)) {
        seen.add(h);
        originalHeaders.push(h);
      }
    });
  });

  const columns = [
    ...originalHeaders.map((h) => ({ header: h, key: h })),
    { header: "Part No (to collect)", key: "__part_no" },
    { header: "Part Name (to collect)", key: "__part_name" },
    { header: "Quantity", key: "__quantity" },
  ];

  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: 20 }));
  sheet.getRow(1).font = { bold: true };

  rows.forEach((r) => {
    const row: Record<string, unknown> = {};
    originalHeaders.forEach((h) => {
      row[h] = r.raw_row?.[h] ?? "";
    });
    row.__part_no = r.part_no ?? "";
    row.__part_name = r.part_name ?? "";
    row.__quantity = r.quantity ?? "";
    sheet.addRow(row);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Supplier_Parts_${branchName.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
