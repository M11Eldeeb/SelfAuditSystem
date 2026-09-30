// Isomorphic (no "use client"/"server-only") - see already-scrapped-workbook.ts.
import ExcelJS from "exceljs";
import type { FlaggedToScrapRow } from "@/lib/warranty-room/flagged-to-scrap";

const COLUMNS: { header: string; key: keyof FlaggedToScrapRow }[] = [
  { header: "Warranty Claim", key: "claim_number" },
  { header: "Work Order", key: "work_order_no" },
  { header: "Part No", key: "part_no" },
  { header: "Part Name", key: "part_name" },
  { header: "Quantity", key: "quantity" },
  { header: "First Submit Date", key: "first_submit_date" },
  { header: "End of Repair Date", key: "repair_end_date" },
  { header: "Holding Period (days)", key: "holding_period_days" },
];

export async function buildFlaggedToScrapWorkbookBuffer(rows: FlaggedToScrapRow[]): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Flagged to be Scrapped");

  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: 22 }));
  sheet.getRow(1).font = { bold: true };

  rows.forEach((r) => {
    const row: Record<string, unknown> = {};
    COLUMNS.forEach((c) => {
      row[c.key] = r[c.key] ?? "";
    });
    sheet.addRow(row);
  });

  return workbook.xlsx.writeBuffer();
}
