// No "server-only" here on purpose: this runs in the browser, same as
// read-spreadsheet.ts, since exceljs is bundled for both directions.
import ExcelJS from "exceljs";

export type SampleExcelRow = {
  branch_name: string;
  claim_number: string;
  work_order_no: string | null;
  vin: string | null;
  vehicle_model: string | null;
  mileage: number | null;
  main_part_name: string | null;
  part_serial_number: string | null;
  part_production_date: string | null;
  repair_end_date: string | null;
  dealer_submit_date: string | null;
  creation_date: string;
  claim_amount: number | null;
  prior_approval: string | null;
  return_times: number | null;
  return_times_dealer: number | null;
  labor_code: string | null;
  flag_score: number | null;
  raw_row: Record<string, unknown>;
};

const STRUCTURED_COLUMNS: { header: string; key: keyof SampleExcelRow }[] = [
  { header: "Branch", key: "branch_name" },
  { header: "Claim Number", key: "claim_number" },
  { header: "Work Order No", key: "work_order_no" },
  { header: "VIN", key: "vin" },
  { header: "Vehicle Model", key: "vehicle_model" },
  { header: "Mileage", key: "mileage" },
  { header: "Main Part Name", key: "main_part_name" },
  { header: "Part Serial Number", key: "part_serial_number" },
  { header: "Part Production Date", key: "part_production_date" },
  { header: "Repair End Date", key: "repair_end_date" },
  { header: "Dealer Submit Date", key: "dealer_submit_date" },
  { header: "Creation Date", key: "creation_date" },
  { header: "Claim Amount", key: "claim_amount" },
  { header: "Prior Approval", key: "prior_approval" },
  { header: "Return Times", key: "return_times" },
  { header: "Return Times (Dealer)", key: "return_times_dealer" },
  { header: "Labor Code", key: "labor_code" },
  { header: "Risk Score", key: "flag_score" },
];

/**
 * A preview-only listing of a proposed internal audit sample, before it's
 * started - every structured claims-data field plus every original sheet
 * column (raw_row), so the officer can review the full claim, not a
 * pre-picked subset.
 */
export async function generateSamplePreviewExcel(rows: SampleExcelRow[]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sample");

  // Union of every original sheet column across the sample, in first-seen order.
  const rawKeys: string[] = [];
  const seen = new Set<string>();
  rows.forEach((r) => {
    Object.keys(r.raw_row ?? {}).forEach((k) => {
      if (!seen.has(k)) {
        seen.add(k);
        rawKeys.push(k);
      }
    });
  });

  sheet.columns = [
    ...STRUCTURED_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: 18 })),
    ...rawKeys.map((k) => ({ header: k, key: `raw:${k}`, width: 18 })),
  ];
  sheet.getRow(1).font = { bold: true };

  rows.forEach((r) => {
    const row: Record<string, unknown> = {};
    STRUCTURED_COLUMNS.forEach((c) => {
      row[c.key] = r[c.key] ?? "";
    });
    rawKeys.forEach((k) => {
      row[`raw:${k}`] = r.raw_row?.[k] ?? "";
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
