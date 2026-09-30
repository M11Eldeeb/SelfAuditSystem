// Isomorphic (no "use client"/"server-only") - see already-scrapped-workbook.ts.
import ExcelJS from "exceljs";
import type { FlaggedToScrapRow } from "@/lib/warranty-room/flagged-to-scrap";

const COLUMNS: { header: string; key: string }[] = [
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

// Carried over from an earlier cycle without destroy evidence ever being
// submitted - the officer wants these visibly distinct from parts newly
// flagged this cycle, not silently written off (see migration 0057).
const WAITING_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFD6A6" },
};

export async function buildFlaggedToScrapWorkbookBuffer(rows: FlaggedToScrapRow[]): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Flagged to be Scrapped");

  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: 22 }));
  sheet.getRow(1).font = { bold: true };

  rows.forEach((r) => {
    const row = sheet.addRow({
      claim_number: r.claim_number,
      work_order_no: r.work_order_no ?? "",
      status_label: r.waiting_for_submission ? "Waiting for destroy evidence submission" : "Flagged this cycle",
      part_no: r.part_no ?? "",
      part_name: r.part_name ?? "",
      quantity: r.quantity ?? "",
      first_submit_date: r.first_submit_date ?? "",
      repair_end_date: r.repair_end_date ?? "",
      holding_period_days: r.holding_period_days ?? "",
    });
    if (r.waiting_for_submission) row.eachCell((cell) => (cell.fill = WAITING_FILL));
  });

  return workbook.xlsx.writeBuffer();
}
