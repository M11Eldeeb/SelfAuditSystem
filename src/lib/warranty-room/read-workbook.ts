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

function readSheet(sheet: ExcelJS.Worksheet): SpreadsheetData {
  const allRows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as unknown[]; // sparse array, index 0 is unused
    allRows.push(values.slice(1).map(cellToPlainValue));
  });

  const [headerRow, ...rest] = allRows;
  const headers = (headerRow ?? []).map((h) => (h == null ? "" : String(h)).trim());
  return { headers, rows: rest };
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
    result[name] = readSheet(sheet);
  }
  return result;
}

/**
 * Reads the first worksheet plus any of the named sheets, all from a single
 * workbook load. A real "All Claims data" export can carry 4 sheets
 * (Warranty Basic Info, Labor Details, Part Details, Sublet Details) over
 * 100MB total - loading the whole workbook a second time just to pull one
 * named sheet (as two separate readSpreadsheet/readWorkbookSheets calls used
 * to) re-parses everything, including the huge first sheet again, which on
 * a file this size risks the browser tab running out of memory or hanging
 * with no error shown. One load, one pass over the whole workbook, is what
 * ExcelJS.load() does internally anyway either way.
 */
export async function readWorkbookFirstAndNamedSheets(
  buffer: ArrayBuffer,
  extraSheetNames: string[]
): Promise<{ first: SpreadsheetData; named: Record<string, SpreadsheetData> }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const firstSheet = workbook.worksheets[0];
  const first: SpreadsheetData = firstSheet ? readSheet(firstSheet) : { headers: [], rows: [] };

  const named: Record<string, SpreadsheetData> = {};
  for (const name of extraSheetNames) {
    const sheet = workbook.getWorksheet(name);
    if (!sheet) continue;
    named[name] = readSheet(sheet);
  }

  return { first, named };
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
