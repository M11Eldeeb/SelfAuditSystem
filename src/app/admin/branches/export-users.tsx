"use client";

import { useState } from "react";
import { exportUsers, type UserExportRow } from "./actions";
import { downloadXlsx } from "@/components/dashboard/sections/invoicing-export";
import { Glyph } from "@/components/ui/glyph";

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Riyadh" }) : "";

/** Officers: every portal user in one Excel file (no passwords). */
export function ExportUsersButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await exportUsers();
      if (r.error || !r.rows) throw new Error(r.error ?? "Could not read the users.");
      await downloadXlsx(`MG Warranty users ${new Date().toISOString().slice(0, 10)}.xlsx`, "Users", [
        { header: "Name", value: (u: UserExportRow) => u.name, width: 30 },
        { header: "Sign in with", value: (u) => u.login, width: 30 },
        { header: "Email", value: (u) => u.email, width: 34 },
        { header: "Employee No", value: (u) => u.employeeNo, width: 13 },
        { header: "Role", value: (u) => u.role, width: 22 },
        { header: "Branch", value: (u) => u.branch, width: 18 },
        { header: "Sees all officer pages", value: (u) => (u.viewAll ? "Yes" : ""), width: 12 },
        { header: "Must change password", value: (u) => (u.mustChangePassword ? "Yes" : ""), width: 12 },
        { header: "Created", value: (u) => fmt(u.createdAt), width: 20 },
        { header: "Last sign-in", value: (u) => fmt(u.lastSignIn) || "Never", width: 20 },
      ], r.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The download failed - please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 disabled:opacity-50"
      >
        <Glyph name="download" />
        {busy ? "Preparing…" : "Download users (Excel)"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
