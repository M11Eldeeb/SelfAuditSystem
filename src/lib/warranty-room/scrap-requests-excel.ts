// No "server-only" here on purpose - runs in the browser, same as
// src/lib/warranty-room/do-not-scrap-excel.ts.
import ExcelJS from "exceljs";

export type ScrapRequestsExcelRow = {
  claim_number: string;
  work_order_no: string | null;
  status_label: string;
  part_no: string | null;
  part_name: string | null;
  quantity: number | null;
  first_submit_date: string | null;
  repair_end_date: string | null;
  holding_period_days: number | null;
};

const COLUMNS: { header: string; key: keyof ScrapRequestsExcelRow }[] = [
  { header: "Warranty Claim", key: "claim_number" },
  { header: "Work Order", key: "work_order_no" },
  { header: "Status", key: "status_label" },
  { header: "Part No", key: "part_no" },
  { header: "Part Name", key: "part_name" },
  { header: "Quantity", key: "quantity" },
  { header: "First Submit Date", key: "first_submit_date" },
  { header: "End of Repair Date", key: "repair_end_date" },
  { header: "Holding Period (days)", key: "holding_period_days" },
];

export async function generateScrapRequestsExcel(branchName: string, rows: ScrapRequestsExcelRow[]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Parts to Scrap");

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
  a.download = `Parts_To_Scrap_${branchName.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
