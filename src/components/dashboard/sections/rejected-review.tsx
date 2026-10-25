"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getRejectedClaimsForReview, saveRejectedClaimReview, type RejectedReviewRow, type RejectedReviewStatus } from "@/app/admin/dashboard/rejected-review-actions";
import { Card, Label, Metric, Panel, Pill, fmtInt } from "@/components/dashboard/ui";
import { C } from "@/components/dashboard/charts";
import { downloadXlsx } from "./invoicing-export";
import { Glyph } from "@/components/ui/glyph";
import { CarLoaderCard } from "@/components/spinner";

const STATUS: Record<RejectedReviewStatus, { label: string; cls: string }> = {
  resolved: { label: "Resolved", cls: "bg-emerald-600 text-white" },
  appeal_submitted: { label: "Appeal submitted", cls: "bg-[#2d2d2d] text-white" },
  confirmed_rejection: { label: "Confirmed rejection", cls: "bg-[#c4121a] text-white" },
};
type View = "todo" | "done" | "expired" | "all";
const fmtDay = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const copy = (t: string) => void navigator.clipboard?.writeText(t).catch(() => {});

function Row({ r, onSaved, currency }: { r: RejectedReviewRow; onSaved: () => void; currency: string }) {
  const [status, setStatus] = useState<RejectedReviewStatus | null>(r.review?.status ?? null);
  const [note, setNote] = useState(r.review?.note ?? "");
  const [closeDate, setCloseDate] = useState(r.deadline ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = status !== (r.review?.status ?? null) || note !== (r.review?.note ?? "") || closeDate !== (r.deadline ?? "");
  const expired = r.daysLeft != null && r.daysLeft < 0;
  const weekend = r.deadline ? [5, 6].includes(new Date(`${r.deadline}T00:00:00Z`).getUTCDay()) : false;
  const badge =
    r.daysLeft == null ? (
      <Pill tone="warn">enter the estimated close date</Pill>
    ) : expired ? (
      <Pill tone="muted">closed {fmtDay(r.deadline)} - cannot appeal</Pill>
    ) : (
      <Pill tone={r.daysLeft <= 5 ? "bad" : r.daysLeft <= 10 ? "warn" : "good"}>
        {r.daysLeft === 0 ? "last day today" : `${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"} left`} · closes {fmtDay(r.deadline)}
        {weekend ? " (weekend)" : ""}
      </Pill>
    );

  async function save(next: RejectedReviewStatus | null) {
    setSaving(true);
    setMsg(null);
    const res = await saveRejectedClaimReview(r.claimId, next, note, closeDate || null);
    setSaving(false);
    if (res.error) setMsg(res.error);
    else onSaved();
  }

  return (
    <li className={`space-y-2 px-4 py-3 ${expired && !r.review?.status ? "bg-neutral-50" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <button type="button" onClick={() => copy(r.claimNumber)} title="Copy" className="font-mono font-semibold text-[#1d1d1f] hover:underline">
          {r.claimNumber}
        </button>
        {r.workOrder && (
          <button type="button" onClick={() => copy(r.workOrder!.replace(/^[A-Z]+-/i, "").replace(/-\d+$/, ""))} title="Copy the number" className="text-[#6e6e73] hover:underline">
            {r.workOrder}
          </button>
        )}
        <span className="text-xs text-[#6e6e73]">{r.branch}</span>
        <Pill tone="bad">{r.status}</Pill>
        {badge}
        <span className="ml-auto text-sm font-bold text-[#1d1d1f] tabular-nums">{r.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} {currency}</span>
      </div>
      <div className="text-xs text-[#6e6e73]">
        Verified {fmtDay(r.verificationDate)}
        {r.vin && <> · VIN <span className="font-mono">{r.vin}</span></>}
        {r.labor && <> · {r.labor}</>}
        {r.part && <> · {r.part}</>}
      </div>
      {r.fault && <p className="line-clamp-2 text-xs text-[#1d1d1f]">{r.fault}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(STATUS) as RejectedReviewStatus[]).map((k) => (
          <button
            key={k}
            type="button"
            disabled={saving}
            onClick={() => setStatus(status === k ? null : k)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 transition ${status === k ? `${STATUS[k].cls} ring-transparent` : "bg-white text-[#6e6e73] ring-[#d4d4d4] hover:bg-[#f5f5f5]"}`}
          >
            {STATUS[k].label}
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-[11px] font-medium text-[#6e6e73]">
          Est. close date
          <input
            type="date"
            value={closeDate}
            onChange={(e) => setCloseDate(e.target.value)}
            className={`h-8 rounded-lg border px-2 text-xs focus:border-[#2d2d2d] focus:outline-none ${closeDate ? "border-[#d4d4d4]" : "border-amber-400 bg-amber-50"}`}
          />
        </label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Notes (appeal number, reason, what was done...)"
          className="h-8 min-w-0 flex-1 rounded-lg border border-[#d4d4d4] px-2.5 text-xs focus:border-[#2d2d2d] focus:outline-none"
        />
        <button type="button" disabled={saving || !dirty} onClick={() => void save(status)} className="h-8 rounded-lg bg-[#2d2d2d] px-3 text-xs font-semibold text-white disabled:opacity-40">
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
      {(r.review || msg) && (
        <p className="text-[11px] text-[#6e6e73]">
          {msg ? <span className="text-red-600">{msg}</span> : r.review ? `Saved by ${r.review.by ?? "?"} · ${new Date(r.review.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Riyadh" })}` : ""}
        </p>
      )}
    </li>
  );
}

/**
 * Reconciliation → Rejected claims: every claim SAIC rejected. The officer enters the estimated claim close date (after it
 * no appeal is possible) and marks each one resolved, appeal submitted or confirmed rejection, with notes.
 */
export function RejectedReviewSection({ currency }: { currency: string }) {
  const [rows, setRows] = useState<RejectedReviewRow[] | null>(null);
  const [view, setView] = useState<View>("todo");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    getRejectedClaimsForReview().then(setRows, () => setError("Could not load the rejected claims - please try again."));
  }, []);
  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  const all = useMemo(() => rows ?? [], [rows]);
  const todo = all.filter((r) => !r.review?.status && (r.daysLeft == null || r.daysLeft >= 0));
  const done = all.filter((r) => r.review?.status);
  const expired = all.filter((r) => !r.review?.status && r.daysLeft != null && r.daysLeft < 0);
  const dueSoon = todo.filter((r) => r.daysLeft != null && r.daysLeft <= 5);
  const list = (view === "todo" ? [...todo].sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999)) : view === "done" ? done : view === "expired" ? expired : all).filter(
    (r) => !q || `${r.claimNumber} ${r.workOrder ?? ""} ${r.vin ?? ""} ${r.branch}`.toLowerCase().includes(q.toLowerCase())
  );
  const sum = (l: RejectedReviewRow[]) => l.reduce((s, r) => s + r.amount, 0);

  if (!rows) return error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : <CarLoaderCard label="Loading rejected claims…" />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <button type="button" onClick={() => setView("todo")} className="text-left">
          <Card accent={C.red} className="h-full hover:shadow-md">
            <Label>To review</Label>
            <Metric value={fmtInt(todo.length)} unit={`${sum(todo).toLocaleString("en-US", { maximumFractionDigits: 0 })} ${currency}`} tone="red" />
            <div className="text-xs text-[#6e6e73]">not handled, close date not passed</div>
          </Card>
        </button>
        <button type="button" onClick={() => setView("todo")} className="text-left">
          <Card accent={C.amber} className="h-full hover:shadow-md">
            <Label>Due in 5 days or less</Label>
            <Metric value={fmtInt(dueSoon.length)} />
            <div className="text-xs text-[#6e6e73]">act first on these</div>
          </Card>
        </button>
        <button type="button" onClick={() => setView("done")} className="text-left">
          <Card accent={C.green} className="h-full hover:shadow-md">
            <Label>Reviewed</Label>
            <Metric value={fmtInt(done.length)} />
            <div className="text-xs text-[#6e6e73]">
              {(Object.keys(STATUS) as RejectedReviewStatus[]).map((k) => `${done.filter((r) => r.review?.status === k).length} ${STATUS[k].label.toLowerCase()}`).join(" · ")}
            </div>
          </Card>
        </button>
        <button type="button" onClick={() => setView("expired")} className="text-left">
          <Card accent={C.slate} className="h-full hover:shadow-md">
            <Label>Missed (window closed)</Label>
            <Metric value={fmtInt(expired.length)} />
            <div className="text-xs text-[#6e6e73]">close date passed before a review</div>
          </Card>
        </button>
      </div>

      <Panel
        title="Rejected claims"
        subtitle="Enter each claim's estimated close date - after it the claim is closed and cannot be appealed. A monthly summary and a weekend-deadline reminder are e-mailed to the officers."
        action={
          <button
            type="button"
            onClick={() =>
              void downloadXlsx(
                "Rejected claims review.xlsx",
                "Rejected claims",
                [
                  { header: "Claim", value: (r: RejectedReviewRow) => r.claimNumber, width: 22 },
                  { header: "Work order", value: (r) => r.workOrder },
                  { header: "Branch", value: (r) => r.branch, width: 18 },
                  { header: "VIN", value: (r) => r.vin, width: 20 },
                  { header: "Export status", value: (r) => r.status },
                  { header: "Verification date", value: (r) => r.verificationDate },
                  { header: "Estimated close date", value: (r) => r.deadline },
                  { header: "Days left", value: (r) => r.daysLeft },
                  { header: `Claim amount (${currency})`, value: (r) => r.amount, money: true },
                  { header: "Main labor", value: (r) => r.labor, width: 30 },
                  { header: "Main part", value: (r) => r.part, width: 30 },
                  { header: "Review", value: (r) => (r.review?.status ? STATUS[r.review.status].label : "") },
                  { header: "Notes", value: (r) => r.review?.note ?? "", width: 40 },
                ],
                list
              )
            }
            className="rounded-lg border border-[#d4d4d4] bg-white px-3 py-1.5 text-xs font-semibold text-[#2d2d2d] shadow-sm hover:bg-[#f5f5f5]"
          >
            <Glyph name="download" className="mr-1" />Export
          </button>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {(
            [
              ["todo", `To review (${todo.length})`],
              ["done", `Reviewed (${done.length})`],
              ["expired", `Window closed (${expired.length})`],
              ["all", `All (${all.length})`],
            ] as [View, string][]
          ).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setView(k)} className={`rounded-full px-3 py-1 text-xs font-semibold ${view === k ? "bg-[#2d2d2d] text-white" : "bg-white text-[#6e6e73] ring-1 ring-[#d4d4d4]"}`}>
              {label}
            </button>
          ))}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search claim, work order, VIN, branch" className="ml-auto h-8 w-64 max-w-full rounded-lg border border-[#d4d4d4] px-2.5 text-xs" />
        </div>
        {list.length === 0 ? (
          <p className="py-8 text-center text-sm text-[#6e6e73]">{view === "todo" ? "Nothing to review - every rejected claim is handled." : "No claims here."}</p>
        ) : (
          <ul className="divide-y divide-[#ececec] rounded-lg ring-1 ring-[#ececec]">
            {list.map((r) => (
              <Row key={`${r.claimId}|${r.review?.at ?? ""}`} r={r} onSaved={load} currency={currency} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
