// No "server-only" here on purpose: this runs in the browser, parsing the
// spreadsheet client-side so the raw file (which can be 50MB+) never has to
// be uploaded as a request body - Vercel's serverless functions cap request
// bodies at 4.5MB, non-configurably. Only the parsed claim rows go over the
// network afterward, in small chunks.
import ExcelJS from "exceljs";

export interface SpreadsheetData {
  headers: string[];
  rows: unknown[][];
}

export async function readSpreadsheet(buffer: ArrayBuffer, filename: string): Promise<SpreadsheetData> {
  if (filename.toLowerCase().endsWith(".csv")) {
    return parseCsv(new TextDecoder("utf-8").decode(buffer));
  }
  return parseXlsx(buffer);
}

async function parseXlsx(buffer: ArrayBuffer): Promise<SpreadsheetData> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const allRows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as unknown[]; // sparse array, index 0 is unused
    allRows.push(values.slice(1).map(cellToPlainValue));
  });

  const [headerRow, ...rest] = allRows;
  const headers = (headerRow ?? []).map((h) => (h == null ? "" : String(h)).trim());
  return { headers, rows: rest };
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

function parseCsv(text: string): SpreadsheetData {
  const records = parseCsvRecords(text.replace(/\r\n/g, "\n"));
  const [headers, ...rows] = records;
  return { headers: (headers ?? []).map((h) => h.trim()), rows };
}

function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records.filter((r) => r.some((c) => c.trim() !== ""));
}
