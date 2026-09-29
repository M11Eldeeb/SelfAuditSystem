// No "server-only" here on purpose - runs in the browser, same as
// src/lib/warranty-room/do-not-scrap-excel.ts.
import ExcelJS from "exceljs";
import type { AlreadyScrappedRow } from "@/lib/warranty-room/already-scrapped";

const STATUS_LABELS: Record<string, string> = {
  pending: "Flagged to scrap (this cycle)",
  presumed_scrapped: "Presumed scrapped (holding period exceeded)",
  scrapped: "Scrapped (video submitted)",
  scrapped_legacy: "Scrapped (prior system)",
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

export async function generateAlreadyScrappedExcel(branchName: string, rows: AlreadyScrappedRow[]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Already Scrapped");

  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: 22 }));
  sheet.getRow(1).font = { bold: true };

  rows.forEach((r) => {
    sheet.addRow({
      claim_number: r.claim_number,
      work_order_no: r.work_order_no ?? "",
      status_label: STATUS_LABELS[r.status] ?? r.status,
      part_no: r.part_no ?? "",
      part_name: r.part_name ?? "",
      quantity: r.quantity ?? "",
      first_submit_date: r.first_submit_date ?? "",
      repair_end_date: r.repair_end_date ?? "",
      holding_period_days: r.holding_period_days ?? "",
      submitted_at: r.submitted_at ?? "",
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Already_Scrapped_${branchName.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
