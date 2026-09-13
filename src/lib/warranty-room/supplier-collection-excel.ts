// No "server-only" here on purpose - runs in the browser, same as
// src/lib/internal-audit-sample-excel.ts.
import ExcelJS from "exceljs";

export type SupplierCollectionExcelRow = {
  claim_number: string;
  work_order_no: string | null;
  vin: string | null;
  part_no: string | null;
  part_name: string | null;
  main_labor_name: string | null;
  planned_pickup_date: string | null;
};

const COLUMNS: { header: string; key: keyof SupplierCollectionExcelRow }[] = [
  { header: "Warranty Claim", key: "claim_number" },
  { header: "Work Order", key: "work_order_no" },
  { header: "VIN", key: "vin" },
  { header: "Part No", key: "part_no" },
  { header: "Part Name", key: "part_name" },
  { header: "Main Labor", key: "main_labor_name" },
  { header: "Planned Pickup Date", key: "planned_pickup_date" },
];

export async function generateSupplierCollectionExcel(branchName: string, rows: SupplierCollectionExcelRow[]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Supplier Parts");

  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: 20 }));
  sheet.getRow(1).font = { bold: true };

  rows.forEach((r) => {
    const row: Record<string, unknown> = {};
    COLUMNS.forEach((c) => {
      row[c.key] = r[c.key] ?? "";
    });
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
