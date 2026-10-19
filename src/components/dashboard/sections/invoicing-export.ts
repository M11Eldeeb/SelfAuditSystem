// Excel downloads for the Warranty Invoicing tab (built in the browser; exceljs is loaded only when needed).
import type { InvoicingDetailRow } from "@/app/admin/dashboard/invoicing-actions";

export type ExportColumn<T> = { header: string; value: (r: T) => string | number | null; width?: number; money?: boolean };

export async function downloadXlsx<T>(fileName: string, sheet: string, columns: ExportColumn<T>[], rows: T[]): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet.slice(0, 31));
  ws.columns = columns.map((c, i) => ({ header: c.header, key: String(i), width: c.width ?? Math.max(12, c.header.length + 2) }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F4F1" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) ws.addRow(Object.fromEntries(columns.map((c, i) => [String(i), c.value(r) ?? ""])));
  columns.forEach((c, i) => {
    if (c.money) ws.getColumn(i + 1).numFmt = "#,##0.00";
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.replace(/[\\/:*?"<>|]+/g, "_");
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const LINE_COLUMNS: ExportColumn<InvoicingDetailRow>[] = [
  { header: "Invoice date", value: (r) => r.date, width: 12 },
  { header: "Labor / Parts", value: (r) => (r.source === "labor" ? "Labor" : "Parts") },
  { header: "Branch", value: (r) => r.branch, width: 8 },
  { header: "WIP", value: (r) => r.wip },
  { header: "Invoice", value: (r) => r.invoice },
  { header: "Account code", value: (r) => r.account },
  { header: "Account name", value: (r) => r.accountName, width: 34 },
  { header: "Owing operator", value: (r) => r.operator, width: 20 },
  { header: "Sales type", value: (r) => r.type },
  { header: "Department", value: (r) => r.department, width: 15 },
  { header: "VIN", value: (r) => r.vin, width: 20 },
  { header: "Part / labor code", value: (r) => r.item, width: 16 },
  { header: "Description", value: (r) => r.description, width: 36 },
  { header: "Customer", value: (r) => r.customer, width: 28 },
  { header: "Qty / hours", value: (r) => r.qty },
  { header: "Amount (SAR)", value: (r) => r.amount, money: true, width: 14 },
  { header: "Amount (USD)", value: (r) => Math.round((r.amount / 3.75) * 100) / 100, money: true, width: 14 },
];
