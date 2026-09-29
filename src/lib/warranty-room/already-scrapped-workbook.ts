// Isomorphic (no "use client"/"server-only") - ExcelJS's buffer generation
// runs the same in Node and the browser. Split out from
// already-scrapped-excel.ts so the download API route (server-side) and the
// old in-browser path can share the exact same workbook-building logic.
import ExcelJS from "exceljs";
import type { AlreadyScrappedRow } from "@/lib/warranty-room/already-scrapped";

export const ALREADY_SCRAPPED_STATUS_LABELS: Record<string, string> = {
  pending: "Flagged to scrap (this cycle)",
  presumed_scrapped: "Presumed scrapped (holding period exceeded)",
  scrapped: "Scrapped (video submitted)",
  scrapped_legacy: "Scrapped (prior system)",
  supplier_collected: "Collected by supplier",
};

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
  { header: "Submitted At", key: "submitted_at" },
];

export async function buildAlreadyScrappedWorkbookBuffer(rows: AlreadyScrappedRow[]): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Already Scrapped");

  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: 22 }));
  sheet.getRow(1).font = { bold: true };

  rows.forEach((r) => {
    sheet.addRow({
      claim_number: r.claim_number,
      work_order_no: r.work_order_no ?? "",
      status_label: ALREADY_SCRAPPED_STATUS_LABELS[r.status] ?? r.status,
      part_no: r.part_no ?? "",
      part_name: r.part_name ?? "",
      quantity: r.quantity ?? "",
      first_submit_date: r.first_submit_date ?? "",
      repair_end_date: r.repair_end_date ?? "",
      holding_period_days: r.holding_period_days ?? "",
      submitted_at: r.submitted_at ?? "",
    });
  });

  return workbook.xlsx.writeBuffer();
}
