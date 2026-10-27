"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importTechnicians, type TechnicianResult, type TechnicianRow } from "./actions";
import { downloadXlsx } from "@/components/dashboard/sections/invoicing-export";

const HEADERS = { name: ["name", "full name", "technician", "technician name"], employeeNo: ["employee no", "employee no.", "employee number", "emp no", "id", "employee id"], branch: ["branch", "branch name", "branch code"], email: ["email", "e-mail", "mail"] };

const cellText = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "object" && v !== null) {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if (o.text != null) return String(o.text);
    if (o.result != null) return String(o.result);
  }
  return String(v).trim();
};

/** Reads the first sheet: a header row with Name, Employee No, Branch, Email (optional), then one technician per row. */
async function readList(file: File): Promise<(TechnicianRow & { row: number })[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("The file has no sheet.");
  const head = (ws.getRow(1).values as unknown[]).map((v) => cellText(v).toLowerCase());
  const col = (k: keyof typeof HEADERS) => head.findIndex((h) => HEADERS[k].includes(h));
  const c = { name: col("name"), employeeNo: col("employeeNo"), branch: col("branch"), email: col("email") };
  if (c.name < 0 || c.employeeNo < 0 || c.branch < 0) throw new Error("The first row must have the columns: Name, Employee No, Branch (and Email if they have one).");
  const rows: (TechnicianRow & { row: number })[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const v = r.values as unknown[];
    const row = { row: n, name: cellText(v[c.name]), employeeNo: cellText(v[c.employeeNo]), branch: cellText(v[c.branch]), email: c.email >= 0 ? cellText(v[c.email]) : "" };
    if (row.name || row.employeeNo) rows.push(row);
  });
  return rows;
}

/** Officers: create many technician accounts from one Excel list; the temporary passwords come back as an Excel file. */
export function TechnicianImport() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<(TechnicianRow & { row: number })[] | null>(null);
  const [results, setResults] = useState<TechnicianResult[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState("");

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setResults(null);
    try {
      const list = await readList(file);
      if (!list.length) throw new Error("No technicians found in the file.");
      setRows(list);
    } catch (e) {
      setRows(null);
      setError(e instanceof Error ? e.message : "Could not read the file.");
    }
  }

  async function run() {
    if (!rows) return;
    setBusy(true);
    setError(null);
    const out: TechnicianResult[] = [];
    try {
      for (let i = 0; i < rows.length; i += 25) {
        setStatus(`Creating accounts ${i + 1}-${Math.min(i + 25, rows.length)} of ${rows.length}...`);
        const r = await importTechnicians(rows.slice(i, i + 25), shared);
        if (r.error) throw new Error(r.error);
        out.push(...r.results);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "The import stopped - the accounts listed below were handled.");
    }
    setResults(out);
    setRows(null);
    setBusy(false);
    setStatus(null);
    router.refresh();
    if (out.some((r) => r.tempPassword)) void downloadPasswords(out);
  }

  const downloadPasswords = (list: TechnicianResult[]) =>
    downloadXlsx(`Technician accounts ${new Date().toISOString().slice(0, 10)}.xlsx`, "Accounts", [
      { header: "Row", value: (r: TechnicianResult) => r.row, width: 6 },
      { header: "Name", value: (r) => r.name, width: 28 },
      { header: "Employee No", value: (r) => r.employeeNo, width: 14 },
      { header: "Branch", value: (r) => r.branch, width: 18 },
      { header: "Sign in with", value: (r) => r.login, width: 22 },
      { header: "Temporary password", value: (r) => r.tempPassword ?? "", width: 22 },
      { header: "Result", value: (r) => r.error ?? "Created", width: 30 },
    ], list);

  const template = () =>
    downloadXlsx("Technicians template.xlsx", "Technicians", [
      { header: "Name", value: (r: TechnicianRow) => r.name, width: 28 },
      { header: "Employee No", value: (r) => r.employeeNo, width: 14 },
      { header: "Branch", value: (r) => r.branch, width: 18 },
      { header: "Email", value: (r) => r.email, width: 30 },
    ], [{ name: "Example Name", employeeNo: "12345", branch: "Branch name or code", email: "" }]);

  const created = results?.filter((r) => r.tempPassword).length ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-neutral-900">Import technicians from Excel</h2>
          <p className="text-xs text-neutral-500">Columns: Name, Employee No, Branch (name or code), Email (optional). Without an e-mail, the technician signs in with the employee number.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={template} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50">
            Template
          </button>
          <input ref={input} type="file" accept=".xlsx" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
            Choose Excel file
          </button>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {status && <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">{status}</p>}

      {rows && (
        <div className="space-y-2">
          <div className="max-h-64 overflow-auto rounded-lg border border-neutral-200 text-sm">
            <table className="w-full">
              <thead className="sticky top-0 bg-neutral-50 text-left text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-1.5">Name</th>
                  <th className="px-3 py-1.5">Employee No</th>
                  <th className="px-3 py-1.5">Branch</th>
                  <th className="px-3 py-1.5">Email</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map((r) => (
                  <tr key={r.row}>
                    <td className="px-3 py-1">{r.name}</td>
                    <td className="px-3 py-1">{r.employeeNo}</td>
                    <td className="px-3 py-1">{r.branch}</td>
                    <td className="px-3 py-1 text-neutral-500">{r.email || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="block max-w-sm space-y-1">
            <span className="block text-xs font-medium text-neutral-700">Same password for everyone (optional, at least 8 characters)</span>
            <input
              type="password"
              autoComplete="new-password"
              value={shared}
              onChange={(e) => setShared(e.target.value)}
              placeholder="Leave empty for a different temporary password each"
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm"
            />
            <span className="block text-xs text-neutral-500">Every technician must choose his own password the first time he signs in.</span>
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={busy || (shared.length > 0 && shared.length < 8)} onClick={run} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
              Create {rows.length} account{rows.length === 1 ? "" : "s"}
            </button>
            <button type="button" disabled={busy} onClick={() => setRows(null)} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700">
              Cancel
            </button>
          </div>
        </div>
      )}

      {results && (
        <div className="space-y-2 rounded-lg bg-neutral-50 p-3 text-sm">
          <p>
            <span className="font-semibold">{created} created</span>
            {results.length - created > 0 && <span className="text-amber-800"> · {results.length - created} skipped</span>}. The Excel list was downloaded - each technician signs in with his employee number and must choose his own password the first time.
          </p>
          <button type="button" onClick={() => void downloadPasswords(results)} className="text-sm font-medium text-brand hover:underline">
            Download again
          </button>
          {results.filter((r) => r.error).length > 0 && (
            <ul className="list-disc pl-5 text-xs text-amber-900">
              {results
                .filter((r) => r.error)
                .map((r) => (
                  <li key={r.row}>
                    Row {r.row} ({r.name || r.employeeNo}): {r.error}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
