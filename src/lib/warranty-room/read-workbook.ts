// Client-side, multi-sheet-capable spreadsheet reader for Warranty Room
// uploads (the "All Claims data" file has both a "Warranty Basic Info" and a
// "Part Details" sheet that both need reading from the same upload). Kept
// separate from src/lib/read-spreadsheet.ts (which only ever reads the first
// worksheet, by design, for the existing self-audit claims upload) rather
// than changing that file's behavior.
import ExcelJS from "exceljs";

export interface SpreadsheetData {
  headers: string[];
  rows: unknown[][];
}

/** Reads every named sheet found in the workbook; sheets not present are simply absent from the result. */
export async function readWorkbookSheets(
  buffer: ArrayBuffer,
  sheetNames: string[]
): Promise<Record<string, SpreadsheetData>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const result: Record<string, SpreadsheetData> = {};
  for (const name of sheetNames) {
    const sheet = workbook.getWorksheet(name);
    if (!sheet) continue;

    const allRows: unknown[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as unknown[]; // sparse array, index 0 is unused
      allRows.push(values.slice(1).map(cellToPlainValue));
    });

    const [headerRow, ...rest] = allRows;
    const headers = (headerRow ?? []).map((h) => (h == null ? "" : String(h)).trim());
    result[name] = { headers, rows: rest };
  }
  return result;
}

function cellToPlainValue(value: unknown): unknown {
  if (value instanceof Date) return value;
  if (value && typeof value === "object") {
    if ("text" in value) return (value as { text: unknown }).text;
    if ("richText" in value) {
      const parts = (value as { richText: { text: string }[] }).richText;
      return parts.map((p) => p.text).join("");
    }
    if ("result" in value) return (value as { result: unknown }).result; // formula cell
  }
  return value;
}
