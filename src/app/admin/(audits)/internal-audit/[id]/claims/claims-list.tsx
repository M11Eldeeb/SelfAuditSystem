"use client";

import Link from "next/link";
import { useState } from "react";
import { savePartCheck, type PartCheck } from "./actions";
import { downloadXlsx, type ExportColumn } from "@/components/dashboard/sections/invoicing-export";
import { CopyText } from "@/components/copy-text";
import { Glyph } from "@/components/ui/glyph";

export type AuditClaimRow = {
  id: string;
  index: number;
  announced: boolean;
  claimNumber: string;
  workOrder: string | null;
  vin: string | null;
  model: string | null;
  mileage: number | null;
  mainPart: string | null;
  expectedSerial: string | null;
  expectedOffline: string | null;
  repairEnd: string | null;
  submitted: string | null;
  laborCode: string | null;
  amount: number | null;
  parts: { partNo: string | null; name: string | null; qty: number | null }[];
  check: PartCheck;
  checkedAt: string | null;
  checkedBy: string | null;
};

const checkState = (r: AuditClaimRow) => (r.check.method === "serial" ? !!r.check.serial : r.check.method === "offline" ? !!r.check.offlineDate : false);

/** One claim: a row; open it for the details, its parts and the pre-visit check. */
function ClaimRow({ r, auditId, locked, onSaved }: { r: AuditClaimRow; auditId: string; locked: boolean; onSaved: (r: AuditClaimRow) => void }) {
  const [open, setOpen] = useState(false);
  const [check, setCheck] = useState<PartCheck>({ ...r.check, method: r.check.method ?? (r.expectedSerial ? "serial" : r.expectedOffline ? "offline" : null) });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(check) !== JSON.stringify(r.check);
  const done = checkState(r);

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await savePartCheck(r.id, check);
    setBusy(false);
    if (res.error) return setMsg({ ok: false, text: res.error });
    onSaved({ ...r, check, checkedAt: res.at ?? null, checkedBy: res.by ?? null });
    setMsg({ ok: true, text: "Saved." });
  }

  const serialMatch = check.method === "serial" && check.serial && r.expectedSerial ? check.serial.trim().toUpperCase() === r.expectedSerial.trim().toUpperCase() : null;
  const offlineMatch = check.method === "offline" && check.offlineDate && r.expectedOffline ? check.offlineDate === r.expectedOffline.slice(0, 10) : null;

  return (
    <>
      <tr onClick={() => setOpen((o) => !o)} className={`cursor-pointer hover:bg-neutral-50 ${open ? "bg-neutral-50" : ""}`}>
        <td className="px-3 py-2 text-neutral-500 tabular-nums">
          <span className={`me-1 inline-block transition-transform ${open ? "rotate-90" : ""}`}>›</span>
          {r.index + 1}
        </td>
        <td className="px-3 py-2 font-medium">
          <CopyText value={r.claimNumber} label="claim number" />
        </td>
        <td className="px-3 py-2">
          <CopyText value={r.workOrder} label="work order" />
        </td>
        <td className="px-3 py-2 font-mono text-xs">
          <CopyText value={r.vin} label="VIN" />
        </td>
        <td className="max-w-[14rem] truncate px-3 py-2" title={r.mainPart ?? ""}>
          {r.mainPart ?? "—"}
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          {done ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">{r.check.method === "serial" ? "Serial checked" : "Offline date checked"}</span>
          ) : (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">Not checked</span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-neutral-50">
          <td colSpan={6} className="px-4 pb-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-white p-3 text-xs ring-1 ring-neutral-200">
                {(
                  [
                    ["Model", r.model],
                    ["Mileage", r.mileage?.toLocaleString("en-US")],
                    ["Repair end", r.repairEnd],
                    ["Dealer submit", r.submitted],
                    ["Labor code", r.laborCode],
                    ["Claim amount", r.amount?.toLocaleString("en-US", { maximumFractionDigits: 2 })],
                    ["Part serial (claim)", r.expectedSerial],
                    ["Offline / production date (claim)", r.expectedOffline],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-neutral-500">{k}</dt>
                    <dd className="font-medium text-neutral-900">{v || "—"}</dd>
                  </div>
                ))}
                <div className="col-span-2 mt-2">
                  <div className="mb-1 text-neutral-500">Parts</div>
                  {r.parts.length ? (
                    <ul className="space-y-0.5">
                      {r.parts.map((p, i) => (
                        <li key={i}>
                          <span className="font-mono">{p.partNo ?? "—"}</span> {p.name ?? ""} {p.qty != null ? `× ${p.qty}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span>{r.mainPart ?? "—"}</span>
                  )}
                </div>
                <div className="col-span-2 mt-2">
                  <Link href={`/admin/internal-audit/${auditId}?claim=${r.index}`} className="text-brand hover:underline">
                    Open in the audit →
                  </Link>
                </div>
              </dl>

              <div className="space-y-2 rounded-lg bg-white p-3 text-sm ring-1 ring-neutral-200" onClick={(e) => e.stopPropagation()}>
                <div className="text-xs font-semibold text-neutral-900">Part check</div>
                <div className="inline-flex rounded-lg bg-neutral-900/[0.05] p-0.5 text-xs font-medium" role="group" aria-label="Verified by">
                  {(
                    [
                      ["serial", "Serial number"],
                      ["offline", "Offline date"],
                    ] as const
                  ).map(([k, l]) => (
                    <button key={k} type="button" disabled={locked} aria-pressed={check.method === k} onClick={() => setCheck((c) => ({ ...c, method: k }))} className={`rounded-md px-3 py-1 ${check.method === k ? "bg-white shadow-sm" : "text-neutral-600"}`}>
                      {l}
                    </button>
                  ))}
                </div>
                {check.method === "serial" && (
                  <label className="block space-y-1">
                    <span className="text-xs text-neutral-500">Serial number found {r.expectedSerial ? `(claim: ${r.expectedSerial})` : ""}</span>
                    <input value={check.serial ?? ""} disabled={locked} onChange={(e) => setCheck((c) => ({ ...c, serial: e.target.value }))} className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 font-mono text-sm" placeholder="Part serial number" />
                    {serialMatch != null && <span className={`text-xs font-semibold ${serialMatch ? "text-emerald-700" : "text-red-700"}`}>{serialMatch ? "Matches the claim" : "Does not match the claim"}</span>}
                  </label>
                )}
                {check.method === "offline" && (
                  <label className="block space-y-1">
                    <span className="text-xs text-neutral-500">Offline date found {r.expectedOffline ? `(claim: ${r.expectedOffline.slice(0, 10)})` : ""}</span>
                    <input type="date" value={check.offlineDate ?? ""} disabled={locked} onChange={(e) => setCheck((c) => ({ ...c, offlineDate: e.target.value || null }))} className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm" />
                    {offlineMatch != null && <span className={`text-xs font-semibold ${offlineMatch ? "text-emerald-700" : "text-red-700"}`}>{offlineMatch ? "Matches the claim" : "Does not match the claim"}</span>}
                  </label>
                )}
                <textarea value={check.note ?? ""} disabled={locked} onChange={(e) => setCheck((c) => ({ ...c, note: e.target.value }))} rows={2} placeholder="Note (optional)" className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm" />
                <div className="flex items-center gap-3">
                  {!locked && (
                    <button type="button" disabled={busy || !dirty} onClick={() => void save()} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                      {busy ? "Saving…" : "Save"}
                    </button>
                  )}
                  {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</span>}
                  {r.checkedAt && (
                    <span className="text-xs text-neutral-400">
                      {r.checkedBy} · {r.checkedAt.slice(0, 10)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** The two lists (announced, unannounced), each with its download. */
export function AuditClaimsList({ auditId, rows: initial, locked }: { auditId: string; rows: AuditClaimRow[]; locked: boolean }) {
  const [rows, setRows] = useState(initial);
  const replace = (r: AuditClaimRow) => setRows((list) => list.map((x) => (x.id === r.id ? r : x)));
  const cols: ExportColumn<AuditClaimRow>[] = [
    { header: "#", value: (r) => r.index + 1 },
    { header: "Claim", value: (r) => r.claimNumber, width: 22 },
    { header: "Work order", value: (r) => r.workOrder },
    { header: "VIN", value: (r) => r.vin, width: 20 },
    { header: "Model", value: (r) => r.model },
    { header: "Main part", value: (r) => r.mainPart, width: 30 },
    { header: "Parts", value: (r) => r.parts.map((p) => `${p.partNo ?? ""} ${p.name ?? ""}${p.qty != null ? ` x${p.qty}` : ""}`).join(" | "), width: 40 },
    { header: "Part serial (claim)", value: (r) => r.expectedSerial, width: 20 },
    { header: "Offline date (claim)", value: (r) => r.expectedOffline?.slice(0, 10) ?? "" },
    { header: "Verified by", value: (r) => (r.check.method === "serial" ? "Serial number" : r.check.method === "offline" ? "Offline date" : "") },
    { header: "Serial found", value: (r) => r.check.serial, width: 20 },
    { header: "Offline date found", value: (r) => r.check.offlineDate },
    { header: "Note", value: (r) => r.check.note, width: 30 },
    { header: "Repair end", value: (r) => r.repairEnd },
    { header: "Mileage", value: (r) => r.mileage },
  ];

  const section = (title: string, list: AuditClaimRow[], file: string, note: string) => (
    <section className="space-y-2 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-neutral-900">
            {title} <span className="text-sm font-normal text-neutral-500">({list.length})</span>
          </h2>
          <p className="text-xs text-neutral-500">{note}</p>
        </div>
        <button type="button" disabled={!list.length} onClick={() => void downloadXlsx(file, title.slice(0, 30), cols, list)} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 disabled:opacity-40">
          <Glyph name="download" /> Download list
        </button>
      </div>
      {list.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-neutral-200 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Claim</th>
                <th className="px-3 py-2 font-medium">Work order</th>
                <th className="px-3 py-2 font-medium">VIN</th>
                <th className="px-3 py-2 font-medium">Main part</th>
                <th className="px-3 py-2 font-medium">Part check</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {list.map((r) => (
                <ClaimRow key={r.id} r={r} auditId={auditId} locked={locked} onSaved={replace} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-3 text-sm text-neutral-500">None.</p>
      )}
    </section>
  );

  const announced = rows.filter((r) => r.announced);
  const unannounced = rows.filter((r) => !r.announced);
  return (
    <div className="space-y-5">
      {section("Announced claims", announced, "Internal audit - announced claims.xlsx", "Sent to the branch before the visit.")}
      {section("Unannounced claims", unannounced, "Internal audit - unannounced claims.xlsx", "Officers only - not in the list sent to the branch; ask for them at the visit.")}
    </div>
  );
}
