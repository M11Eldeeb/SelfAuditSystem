"use client";

import { useEffect, useRef, useState } from "react";
import { getUpcomingAuditSample } from "./upcoming-audit-actions";

export type UpcomingAudit = {
  id: string;
  name: string;
  /** Pre-formatted on the server, e.g. "Wednesday, 14 October 2026"; null when no date is set yet. */
  dateLabel: string | null;
  /** e.g. "in 2 days" / "tomorrow" / "today"; null when no date. */
  whenLabel: string | null;
  claimCount: number;
};

const SEEN_KEY = "upcoming-internal-audit-seen";

function DownloadButton({ audit, className }: { audit: UpcomingAudit; className: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setBusy(true);
    setError(null);
    try {
      const result = await getUpcomingAuditSample(audit.id);
      if ("error" in result && result.error) throw new Error(result.error);
      // exceljs is large, so it is only loaded when someone actually downloads.
      const { generateSamplePreviewExcel } = await import("@/lib/internal-audit-sample-excel");
      const safeName = audit.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "Internal_Audit";
      await generateSamplePreviewExcel(
        result.rows,
        `${safeName}_claims.xlsx`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={handleDownload} disabled={busy} className={className}>
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0">
          <path d="M10 3v9m0 0l-3.5-3.5M10 12l3.5-3.5M4 15.5h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {busy ? "Preparing..." : "Download claim list (Excel)"}
      </button>
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Tells a branch admin about an internal audit coming to their branch: a
 * card that stays on the page, plus a one-time-per-session pop-up, both with
 * the date and the list of claims to be audited as an Excel sheet.
 */
export function UpcomingInternalAudits({ audits }: { audits: UpcomingAudit[] }) {
  const [popupOpen, setPopupOpen] = useState(false);
  const doneRef = useRef<HTMLButtonElement>(null);
  const idsKey = audits.map((a) => a.id).join(",");

  // Pop up once per browser session for this set of audits (flag written only
  // when it actually opens, so a strict-mode effect re-run can't swallow it).
  useEffect(() => {
    if (!idsKey) return;
    try {
      if (sessionStorage.getItem(SEEN_KEY) === idsKey) return;
    } catch {
      // Storage blocked: just show it.
    }
    const t = window.setTimeout(() => {
      try {
        sessionStorage.setItem(SEEN_KEY, idsKey);
      } catch {
        // ignore
      }
      setPopupOpen(true);
    }, 500);
    return () => window.clearTimeout(t);
  }, [idsKey]);

  useEffect(() => {
    if (!popupOpen) return;
    doneRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopupOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [popupOpen]);

  if (audits.length === 0) return null;

  return (
    <>
      <section aria-label="Upcoming internal audit" className="space-y-3">
        {audits.map((a) => (
          <div
            key={a.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm"
          >
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-wider text-amber-800 uppercase">Upcoming internal audit</p>
              <p className="mt-0.5 font-semibold text-neutral-900">{a.dateLabel ? `${a.dateLabel}${a.whenLabel ? ` · ${a.whenLabel}` : ""}` : "Date to be confirmed"}</p>
              <p className="text-sm text-neutral-700">
                {a.claimCount} claim{a.claimCount === 1 ? "" : "s"} will be audited - please have their documents and parts ready.
              </p>
            </div>
            <DownloadButton
              audit={a}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-800 shadow-sm transition-colors hover:bg-amber-100 disabled:opacity-60"
            />
          </div>
        ))}
      </section>

      {popupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="modal-backdrop absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={() => setPopupOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="upcoming-audit-title"
            className="modal-card relative w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-2xl"
          >
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-700 ring-8 ring-amber-50/60">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="4" y="5.5" width="16" height="14" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
                <path d="M4 10h16M8.5 3.5v3.5M15.5 3.5v3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </div>
            <h2 id="upcoming-audit-title" className="text-lg font-bold text-neutral-900">
              {audits.length === 1 ? "Internal audit coming to your branch" : `${audits.length} internal audits coming to your branch`}
            </h2>
            <ul className="mt-3 space-y-3">
              {audits.map((a) => (
                <li key={a.id} className="rounded-lg bg-neutral-50 p-3">
                  <p className="font-semibold text-neutral-900">{a.dateLabel ?? "Date to be confirmed"}</p>
                  {a.whenLabel && <p className="text-sm text-neutral-600">{a.whenLabel}</p>}
                  <p className="mt-1 text-sm text-neutral-700">{a.claimCount} claim{a.claimCount === 1 ? "" : "s"} will be audited.</p>
                  <div className="mt-2.5">
                    <DownloadButton
                      audit={a}
                      className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark disabled:opacity-60"
                    />
                  </div>
                </li>
              ))}
            </ul>
            <button
              ref={doneRef}
              type="button"
              onClick={() => setPopupOpen(false)}
              className="mt-5 w-full rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
