// No "server-only" here on purpose: this runs in the browser, same as
// read-spreadsheet.ts, since exceljs is bundled for both directions.
import ExcelJS from "exceljs";

export type SampleExcelRow = {
  claim_number: string;
  work_order_no: string | null;
  vin: string | null;
  main_part_name: string | null;
  creation_date: string;
  repair_end_date: string | null;
};

// Only the columns the branch admin needs to identify and prep for each
// claim - this sheet is meant to be sent to them, not kept as an internal
// working file, so internal-only data (risk score, dates, amounts, raw sheet
// columns) is deliberately left out.
const COLUMNS: { header: string; key: keyof SampleExcelRow }[] = [
  { header: "VIN", key: "vin" },
  { header: "Warranty Claim", key: "claim_number" },
  { header: "Main Part Name", key: "main_part_name" },
  { header: "Work Order", key: "work_order_no" },
  { header: "Reception Date", key: "creation_date" },
  { header: "Repair End Date", key: "repair_end_date" },
];

export async function generateSamplePreviewExcel(rows: SampleExcelRow[]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sample");

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
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Internal_Audit_Sample_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
