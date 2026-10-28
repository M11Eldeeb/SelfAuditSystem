"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  getPaymentsData,
  importPaymentList,
  preparePaymentUploads,
  registerPaymentFiles,
  removePaymentFile,
  savePayment,
  type PaymentListRow,
  type PaymentRow,
  type PaymentsData,
} from "@/app/admin/dashboard/payment-actions";
import { Card, Label, Metric, Panel, Pill, fmtInt, fmtMoney, fmtNum } from "@/components/dashboard/ui";
import { CarLoaderCard } from "@/components/spinner";
import { Glyph } from "@/components/ui/glyph";
import { uploadToSession } from "@/components/tech-claims/upload";

const fmtDay = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Pending and past the 3-month limit, pending and still in time, or remitted. */
function remitState(r: PaymentRow, today: string) {
  if (r.remitStatus === "remitted") return { tone: "good" as const, label: r.remittedAt ? `Remitted ${fmtDay(r.remittedAt)}` : "Remitted", overdue: false, late: 0 };
  if (r.dueDate && today > r.dueDate) {
    const late = daysBetween(r.dueDate, today);
    return { tone: "bad" as const, label: `Over 3 months · ${late} day${late === 1 ? "" : "s"} late`, overdue: true, late };
  }
  const left = r.dueDate ? daysBetween(today, r.dueDate) : null;
  return { tone: "warn" as const, label: left == null ? "Pending" : `Pending · due ${fmtDay(r.dueDate)} (${left} d)`, overdue: false, late: 0 };
}

const cellText = (v: unknown): string => {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if (o.result != null) return String(o.result);
    if (o.text != null) return String(o.text);
  }
  return String(v).trim();
};

/** SAIC's "Payment List Query List" export: Payment Order, Total Payment Amount(VAT) / (NO-VAT), Currency, Status, Creation Date. */
async function readPaymentList(file: File): Promise<PaymentListRow[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  const head = (ws.getRow(1).values as unknown[]).map((v) => cellText(v).toLowerCase());
  const col = (name: string) => head.indexOf(name.toLowerCase());
  const c = { po: col("Payment Order"), vat: col("Total Payment Amount(VAT)"), novat: col("Total Payment Amount(NO-VAT)"), cur: col("Currency"), st: col("Status"), date: col("Creation Date") };
  if (c.po < 0 || c.vat < 0) throw new Error("This is not the Payment List export (no Payment Order / Total Payment Amount(VAT) columns).");
  const rows: PaymentListRow[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const v = r.values as unknown[];
    const po = cellText(v[c.po]);
    if (!po) return;
    const date = c.date >= 0 ? cellText(v[c.date]).slice(0, 10) : "";
    rows.push({
      paymentOrder: po,
      creationDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
      totalVat: Number(cellText(v[c.vat]).replace(/,/g, "")),
      totalNoVat: c.novat >= 0 ? Number(cellText(v[c.novat]).replace(/,/g, "")) || null : null,
      currency: c.cur >= 0 ? cellText(v[c.cur]) || "USD" : "USD",
      status: c.st >= 0 ? cellText(v[c.st]) || null : null,
    });
  });
  return rows;
}

/** One payment order's own controls: remitted / pending, received amount, notes, evidence. */
function PaymentControls({ row, onChanged }: { row: PaymentRow; onChanged: () => void }) {
  const [received, setReceived] = useState(row.receivedAmount == null ? "" : String(row.receivedAmount));
  const [notes, setNotes] = useState(row.notes ?? "");
  const [notesOpen, setNotesOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function run(label: string, fn: () => Promise<{ error?: string }>) {
    setBusy(label);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (r.error) setError(r.error);
    else onChanged();
  }

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    const files = Array.from(list);
    setBusy("Uploading…");
    setError(null);
    try {
      const prep = await preparePaymentUploads(row.paymentOrder, files.map((f) => ({ name: f.name, type: f.type, size: f.size })));
      if (prep.error || !prep.sessions) throw new Error(prep.error ?? "Could not start the upload.");
      const ids: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setBusy(`Uploading ${i + 1} of ${files.length}…`);
        ids.push(await uploadToSession(prep.sessions[i], files[i], () => undefined));
      }
      const reg = await registerPaymentFiles(row.paymentOrder, ids);
      if (reg.error) throw new Error(reg.error);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The upload failed.");
    } finally {
      setBusy(null);
    }
  }

  const receivedNum = received.trim() === "" ? null : Number(received.replace(/,/g, ""));
  const diff = receivedNum != null && Number.isFinite(receivedNum) ? receivedNum - row.totalVat : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void run("Saving…", () => savePayment(row.paymentOrder, { remitStatus: row.remitStatus === "remitted" ? "pending" : "remitted" }))}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50 ${
            row.remitStatus === "remitted" ? "bg-neutral-900/[0.06] text-neutral-800 hover:bg-neutral-900/[0.1]" : "bg-[#248a3d] text-white hover:bg-[#1f7a35]"
          }`}
        >
          {row.remitStatus === "remitted" ? "Mark as pending" : "Mark as remitted"}
        </button>
        <label className="space-y-1">
          <span className="block text-[12px] text-[#6e6e73]">Received amount ({row.currency}, optional)</span>
          <span className="flex gap-1.5">
            <input
              value={received}
              onChange={(e) => setReceived(e.target.value)}
              inputMode="decimal"
              placeholder={fmtNum(row.totalVat, 2)}
              className="w-36 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-[13px] tabular-nums"
            />
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void run("Saving…", () => savePayment(row.paymentOrder, { receivedAmount: receivedNum }))}
              className="rounded-lg bg-neutral-900/[0.06] px-2.5 text-[13px] font-medium hover:bg-neutral-900/[0.1] disabled:opacity-50"
            >
              Save
            </button>
          </span>
        </label>
        {diff != null && Math.abs(diff) >= 0.01 && (
          <Pill tone={diff < 0 ? "bad" : "muted"}>
            {diff < 0 ? "Short by " : "Over by "}
            {fmtNum(Math.abs(diff), 2)}
          </Pill>
        )}
        <button type="button" onClick={() => setNotesOpen((o) => !o)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-neutral-700 hover:bg-neutral-900/[0.05]">
          <Glyph name="note" /> {row.notes ? "Notes" : "Add note"}
        </button>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
        <button
          type="button"
          disabled={!!busy}
          onClick={() => fileInput.current?.click()}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-brand hover:bg-neutral-900/[0.05] disabled:opacity-50"
        >
          <Glyph name="upload" /> Attach evidence
        </button>
        {busy && <span className="text-[12px] text-[#6e6e73]">{busy}</span>}
      </div>
      {notesOpen && (
        <div className="flex max-w-xl gap-2">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-[13px]" placeholder="Note about this payment" />
          <button
            type="button"
            disabled={!!busy}
            onClick={() => void run("Saving…", () => savePayment(row.paymentOrder, { notes }))}
            className="self-end rounded-lg bg-neutral-900/[0.06] px-3 py-1.5 text-[13px] font-medium hover:bg-neutral-900/[0.1] disabled:opacity-50"
          >
            Save note
          </button>
        </div>
      )}
      {!notesOpen && row.notes && <p className="max-w-xl whitespace-pre-wrap text-[13px] text-[#3a3a3c]">{row.notes}</p>}
      {row.files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {row.files.map((f) => (
            <li key={f.id} className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900/[0.04] px-2.5 py-1 text-[12px]">
              <Glyph name="file" size={13} />
              <a href={`https://drive.google.com/file/d/${f.driveId}/view`} target="_blank" rel="noreferrer" className="max-w-48 truncate hover:underline" title={f.name}>
                {f.name}
              </a>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => window.confirm(`Remove "${f.name}"? It goes to the Drive trash.`) && void run("Removing…", () => removePaymentFile(f.id))}
                className="text-[#6e6e73] hover:text-red-700"
              >
                <Glyph name="close" size={12} />
              </button>
            </li>
          ))}
          {row.driveFolderId && (
            <li>
              <a href={`https://drive.google.com/drive/folders/${row.driveFolderId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-1 py-1 text-[12px] font-medium text-brand hover:underline">
                <Glyph name="folder" size={13} /> Open folder
              </a>
            </li>
          )}
        </ul>
      )}
      {error && <p className="text-[13px] text-red-700">{error}</p>}
    </div>
  );
}

/**
 * Claims & Financials -> Payments tracker (officers): SAIC's monthly payment orders - amount with VAT, the settlement
 * orders and claims behind each (from the claims export), the average days from first submit to settlement, and our
 * own tracking: pending (default) or remitted, received amount, notes, evidence on Google Drive. A pending payment
 * older than 3 months from its creation date is flagged. Below: claims still waiting for a settlement, per
 * first-submit month.
 */
export function PaymentsSection() {
  const [data, setData] = useState<PaymentsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState<string | null>(null);
  const listInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await getPaymentsData());
    } catch {
      setError("Could not load the payments.");
    }
  }, []);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function importList(file: File | undefined) {
    if (!file) return;
    setImporting("Reading the file…");
    try {
      const rows = await readPaymentList(file);
      const r = await importPaymentList(rows);
      if (r.error) throw new Error(r.error);
      setImporting(`${r.added ?? 0} new, ${r.updated ?? 0} updated.`);
      await load();
    } catch (e) {
      setImporting(e instanceof Error ? e.message : "The import failed.");
    }
  }

  if (error) return <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!data) return <CarLoaderCard height="h-80" label="Loading payments…" />;

  const { rows, today } = data;
  const pendingRows = rows.filter((r) => r.remitStatus === "pending");
  const overdueRows = pendingRows.filter((r) => remitState(r, today).overdue);
  const pendingTotal = pendingRows.reduce((s, r) => s + r.totalVat, 0);
  const overdueTotal = overdueRows.reduce((s, r) => s + r.totalVat, 0);
  const yearAgo = new Date(Date.parse(today) - 365 * 86_400_000).toISOString().slice(0, 10);
  const remitted12 = rows.filter((r) => r.remitStatus === "remitted" && (r.creationDate ?? "") >= yearAgo).reduce((s, r) => s + r.totalVat, 0);
  const awaiting = data.pendingByMonth.reduce((s, m) => s + m.amount, 0);
  const awaitingClaims = data.pendingByMonth.reduce((s, m) => s + m.claims, 0);
  const cur = rows[0]?.currency ?? "USD";
  const toggle = (po: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(po)) next.delete(po);
      else next.add(po);
      return next;
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <p className="text-[13px] font-semibold text-[#6e6e73]">Payments</p>
          <h2 className="text-xl font-bold tracking-tight text-[#1d1d1f]">Payments tracker</h2>
          <p className="mt-0.5 text-[14px] text-[#6e6e73]">SAIC payment orders, remittance and evidence. A payment should arrive within {data.remitMonths} months of its creation date.</p>
        </div>
        <span className="flex items-center gap-2">
          {importing && <span className="text-[12px] text-[#6e6e73]">{importing}</span>}
          <input ref={listInput} type="file" accept=".xlsx" hidden onChange={(e) => { void importList(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" onClick={() => listInput.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-[13px] font-medium text-neutral-700 shadow-sm hover:bg-neutral-50">
            <Glyph name="upload" /> Upload payment list
          </button>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <div className="text-[15px] font-semibold text-[#1d1d1f]">Pending remittance</div>
          <Label>{pendingRows.length} payment order{pendingRows.length === 1 ? "" : "s"}</Label>
          <Metric value={fmtMoney(pendingTotal)} unit={cur} />
        </Card>
        <Card>
          <div className="text-[15px] font-semibold text-[#1d1d1f]">Over 3 months</div>
          <Label>{overdueRows.length ? `${overdueRows.length} late - follow up with SAIC` : "Nothing late"}</Label>
          <Metric value={fmtMoney(overdueTotal)} unit={cur} tone={overdueRows.length ? "red" : undefined} />
        </Card>
        <Card>
          <div className="text-[15px] font-semibold text-[#1d1d1f]">Remitted</div>
          <Label>Payment orders of the last 12 months</Label>
          <Metric value={fmtMoney(remitted12)} unit={cur} />
        </Card>
        <Card>
          <div className="text-[15px] font-semibold text-[#1d1d1f]">Awaiting settlement</div>
          <Label>{fmtInt(awaitingClaims)} submitted claims without a settlement order</Label>
          <Metric value={fmtMoney(awaiting)} unit={cur} />
        </Card>
      </div>

      {overdueRows.length > 0 && (
        <div className="rounded-xl bg-[#d70015]/[0.07] px-4 py-3 text-[14px] text-[#b10012] ring-1 ring-[#d70015]/15">
          <b>Over the 3-month limit:</b> {overdueRows.map((r) => `${r.paymentOrder} (${remitState(r, today).late} days late)`).join(" · ")}
        </div>
      )}

      <Panel title="Payment orders" subtitle="Click a payment order to see its settlement orders, record the remittance and attach evidence">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] whitespace-nowrap">
            <thead className="border-b border-neutral-200 text-left text-[12px] text-[#6e6e73]">
              <tr>
                <th className="py-2 pr-3 font-medium">Payment order</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 text-right font-medium">Amount (VAT)</th>
                <th className="px-3 py-2 text-right font-medium">Claims</th>
                <th className="px-3 py-2 text-right font-medium" title="First submit date to settlement date, average of the claims">
                  Avg. settlement
                </th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Received</th>
                <th className="py-2 pl-3 text-right font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 tabular-nums">
              {rows.map((r) => {
                const st = remitState(r, today);
                const isOpen = open.has(r.paymentOrder);
                return (
                  <Fragment key={r.paymentOrder}>
                    <tr className={`cursor-pointer hover:bg-neutral-900/[0.03] ${isOpen ? "bg-neutral-900/[0.03]" : ""}`} onClick={() => toggle(r.paymentOrder)}>
                      <td className="py-2.5 pr-3 font-semibold text-[#1d1d1f]">
                        <span className={`me-1.5 inline-block text-[#8e8e93] transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>
                        {r.paymentOrder}
                      </td>
                      <td className="px-3 py-2.5 text-[#3a3a3c]">{fmtDay(r.creationDate)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-[#1d1d1f]">{fmtNum(r.totalVat, 2)}</td>
                      <td className="px-3 py-2.5 text-right">{r.claims ? fmtInt(r.claims) : "—"}</td>
                      <td className="px-3 py-2.5 text-right">{r.avgDays == null ? "—" : `${fmtNum(r.avgDays, 1)} d`}</td>
                      <td className="px-3 py-2.5">
                        <Pill tone={st.tone}>{st.label}</Pill>
                      </td>
                      <td className="px-3 py-2.5 text-right">{r.receivedAmount == null ? "—" : fmtNum(r.receivedAmount, 2)}</td>
                      <td className="py-2.5 pl-3 text-right text-[#6e6e73]">
                        {r.files.length ? `${r.files.length} file${r.files.length === 1 ? "" : "s"}` : "—"}
                        {r.notes && <Glyph name="note" size={13} className="ms-1.5" label="Has a note" />}
                      </td>
                    </tr>
                    {isOpen && (
                      <>
                        {r.settlements.map((s) => (
                          <tr key={s.settlementOrder} className="text-[#8e8e93]">
                            <td className="py-1.5 pr-3 ps-6">↳ {s.settlementOrder}</td>
                            <td className="px-3 py-1.5 text-[12px]">settlement order</td>
                            <td className="px-3 py-1.5 text-right">{fmtNum(s.settled, 2)}</td>
                            <td className="px-3 py-1.5 text-right">{fmtInt(s.claims)}</td>
                            <td className="px-3 py-1.5 text-right">{s.avgDays == null ? "—" : `${fmtNum(s.avgDays, 1)} d`}</td>
                            <td colSpan={3} />
                          </tr>
                        ))}
                        {r.settlements.length > 0 && Math.abs(r.settledByClaims - r.totalVat) >= 1 && (
                          <tr className="text-[12px] text-[#8e8e93]">
                            <td colSpan={8} className="py-1 ps-6">
                              Claims total {fmtNum(r.settledByClaims, 2)} vs payment {fmtNum(r.totalVat, 2)} - difference {fmtNum(r.totalVat - r.settledByClaims, 2)}
                            </td>
                          </tr>
                        )}
                        {r.settlements.length === 0 && (
                          <tr className="text-[12px] text-[#8e8e93]">
                            <td colSpan={8} className="py-1.5 ps-6">
                              No claims with this payment order in the uploaded claims export.
                            </td>
                          </tr>
                        )}
                        <tr>
                          <td colSpan={8} className="bg-neutral-900/[0.02] px-6 py-3 whitespace-normal">
                            <PaymentControls row={r} onChanged={() => void load()} />
                          </td>
                        </tr>
                      </>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Awaiting settlement by first submission month"
        subtitle="Claims with a first submit date and no settlement order yet - not counting Rejected, Closed, Rejected from chief agent and Returned from chief agent"
      >
        {data.pendingByMonth.length === 0 ? (
          <p className="text-sm text-[#6e6e73]">Every submitted claim has a settlement order.</p>
        ) : (
          <div className="space-y-2">
            {data.pendingByMonth.map((m) => {
              const max = Math.max(...data.pendingByMonth.map((x) => x.amount), 1);
              return (
                <div key={m.month} className="grid grid-cols-[6rem_1fr_auto] items-center gap-3 text-[13px]">
                  <span className="font-medium text-[#1d1d1f]">{monthLabel(m.month)}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-neutral-900/[0.05]">
                    <span className="block h-full rounded-full bg-[#3a3a3c]" style={{ width: `${Math.max((m.amount / max) * 100, 2)}%` }} />
                  </span>
                  <span className="text-right tabular-nums">
                    <b className="text-[#1d1d1f]">{fmtMoney(m.amount)}</b> <span className="text-[#6e6e73]">{cur} · {fmtInt(m.claims)} claims</span>
                  </span>
                </div>
              );
            })}
            <div className="grid grid-cols-[6rem_1fr_auto] gap-3 border-t border-neutral-200 pt-2 text-[13px] font-semibold">
              <span>Total</span>
              <span />
              <span className="text-right tabular-nums">
                {fmtMoney(awaiting)} {cur} · {fmtInt(awaitingClaims)} claims
              </span>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
