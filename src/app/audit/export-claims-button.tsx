"use client";

import { useState } from "react";
import { exportCycleClaims, type AuditClaimExportRow } from "./export-actions";
import { downloadXlsx } from "@/components/dashboard/sections/invoicing-export";
import { Glyph } from "@/components/ui/glyph";

/** The claims of one self-audit cycle in an Excel file (My Audits). */
export function ExportAuditClaimsButton({ cycleId }: { cycleId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await exportCycleClaims(cycleId);
      if (r.error || !r.rows) throw new Error(r.error ?? "Could not read the claims.");
      await downloadXlsx(
        `Self audit claims ${r.cycle}.xlsx`,
        "Self audit claims",
        [
          { header: "Claim #", value: (c: AuditClaimExportRow) => c.claimNumber, width: 20 },
          { header: "Work order #", value: (c) => c.workOrder, width: 16 },
          { header: "VIN", value: (c) => c.vin, width: 20 },
          { header: "Vehicle model", value: (c) => c.model, width: 16 },
          { header: "Mileage", value: (c) => c.mileage, width: 10 },
          { header: "Creation date", value: (c) => c.creationDate, width: 13 },
          { header: "Dealer submit date", value: (c) => c.dealerSubmitDate, width: 16 },
          { header: "Repair end date", value: (c) => c.repairEndDate, width: 14 },
          { header: "Verification date", value: (c) => c.verificationDate, width: 15 },
          { header: "Labor code", value: (c) => c.laborCode, width: 14 },
          { header: "Main part", value: (c) => c.mainPart, width: 28 },
          { header: "Parts", value: (c) => c.parts, width: 40 },
          { header: "Claim amount", value: (c) => c.claimAmount, width: 13, money: true },
          { header: "Prior approval", value: (c) => c.priorApproval, width: 14 },
          { header: "Returns", value: (c) => c.returnTimes, width: 9 },
          { header: "Returns (dealer)", value: (c) => c.returnTimesDealer, width: 14 },
          { header: "Part serial no.", value: (c) => c.partSerial, width: 18 },
          { header: "Part production date", value: (c) => c.partProductionDate, width: 18 },
          { header: "Self audit status", value: (c) => c.auditStatus, width: 18 },
        ],
        r.rows,
      );
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
        className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 disabled:opacity-60"
      >
        <Glyph name="download" />
        {busy ? "Preparing…" : "Download the claims (Excel)"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
