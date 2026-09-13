// No "server-only" here on purpose - runs in the browser, same as
// src/lib/internal-audit-sample-excel.ts.
import ExcelJS from "exceljs";
import type { DoNotScrapRow } from "@/lib/warranty-room/do-not-scrap";

const COLUMNS: { header: string; key: keyof DoNotScrapRow }[] = [
  { header: "Warranty Claim", key: "claim_number" },
  { header: "Work Order", key: "work_order_no" },
  { header: "VIN", key: "vin" },
  { header: "Main Part Name", key: "main_part_name" },
  { header: "Reception Date", key: "creation_date" },
];

export async function generateDoNotScrapExcel(branchName: string, rows: DoNotScrapRow[]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Do Not Scrap");

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
  a.download = `Do_Not_Scrap_${branchName.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
