"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { QcAnalysis, QcCheckBrief } from "@/lib/qc/server";
import { purposeLabel } from "@/lib/qc/constants";

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const fmtDate = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });
const fmtHours = (h: number) => (h >= 24 ? `${(h / 24).toFixed(1)} d` : `${h.toFixed(1)} h`);

type CardKey = "all" | "firstPass" | "failRate" | "attempts" | "waiting" | "closedFail" | "recovered" | "rework" | "comebacks";

type Card = {
  key: CardKey;
  title: string;
  value: string;
  sub: string;
  tone?: "neutral" | "good" | "bad";
  /** The work orders behind the number, newest first unless the card says otherwise. */
  rows: QcCheckBrief[];
  /** What the list is about (its heading). */
  heading: string;
  /** The extra column of the list. */
  extra?: { label: string; value: (r: QcCheckBrief) => string };
  /** A card whose number mixes two groups (first-time pass: passed / failed) lists the other group behind a switch. */
  other?: { label: string; rows: QcCheckBrief[] };
  sort?: (a: QcCheckBrief, b: QcCheckBrief) => number;
};

const byNewest = (a: QcCheckBrief, b: QcCheckBrief) => b.createdAt.localeCompare(a.createdAt);

function buildCards(a: QcAnalysis): Card[] {
  const list = a.checkList;
  const ftpr = a.checks ? a.firstPass / a.checks : 0;
  const comebacks = list.filter((r) => r.purpose === "comeback");
  const tests = (r: QcCheckBrief) => String(r.tests);
  return [
    { key: "all", title: "Vehicles checked", value: String(a.checks), sub: `${a.tests} tests in all`, rows: list, heading: "All vehicles checked", extra: { label: "Tests", value: tests } },
    {
      key: "firstPass",
      title: "First-time pass rate",
      value: pct(a.firstPass, a.checks),
      sub: `${a.firstPass} passed at the first test`,
      tone: !a.checks ? "neutral" : ftpr >= 0.9 ? "good" : "bad",
      rows: list.filter((r) => r.firstPass),
      heading: "Passed at the first test",
      extra: { label: "Tests", value: tests },
      other: { label: "Did not pass at the first test", rows: list.filter((r) => !r.firstPass) },
    },
    { key: "failRate", title: "Fail rate (per test)", value: pct(a.failedTests, a.tests), sub: `${a.failedTests} failed tests`, tone: a.failedTests ? "bad" : "neutral", rows: list.filter((r) => r.fails > 0), heading: "Vehicles with a failed test", extra: { label: "Fails / tests", value: (r) => `${r.fails} / ${r.tests}` }, sort: (x, y) => y.fails - x.fails || byNewest(x, y) },
    {
      key: "attempts",
      title: "Tests per passed vehicle",
      value: a.avgAttemptsToPass != null ? a.avgAttemptsToPass.toFixed(2) : "—",
      sub: "1.00 = all right first time",
      rows: list.filter((r) => r.status === "passed"),
      heading: "Passed vehicles",
      extra: { label: "Tests", value: tests },
      sort: (x, y) => y.tests - x.tests || byNewest(x, y),
    },
    { key: "waiting", title: "Waiting for retest", value: String(a.waiting), sub: `${a.waitingOver24h} for more than 24 h`, tone: a.waiting ? "bad" : "good", rows: list.filter((r) => r.status === "failed"), heading: "Waiting for a retest", extra: { label: "Waiting since", value: (r) => fmtDate(r.updatedAt) }, sort: (x, y) => x.updatedAt.localeCompare(y.updatedAt) },
    { key: "closedFail", title: "Closed as failed", value: String(a.closedFailed), sub: `${pct(a.closedFailed, a.checks)} of the vehicles checked`, tone: a.closedFailed ? "bad" : "good", rows: list.filter((r) => r.status === "closed"), heading: "Closed as failed (no retest)", extra: { label: "Tests", value: tests } },
    { key: "recovered", title: "Fixed after a fail", value: String(a.recovered), sub: "failed, then passed", rows: list.filter((r) => r.recovered), heading: "Failed, then passed", extra: { label: "Tests", value: tests } },
    {
      key: "rework",
      title: "Rework time (median)",
      value: a.medianReworkHours != null ? fmtHours(a.medianReworkHours) : "—",
      sub: "from the fail to the pass",
      rows: list.filter((r) => r.reworkHours != null),
      heading: "Rework time of the vehicles that failed, then passed",
      extra: { label: "Fail to pass", value: (r) => (r.reworkHours != null ? fmtHours(r.reworkHours) : "—") },
      sort: (x, y) => (y.reworkHours ?? 0) - (x.reworkHours ?? 0),
    },
    { key: "comebacks", title: "Comebacks", value: String(comebacks.length), sub: `${pct(comebacks.length, a.checks)} of the vehicles checked`, tone: comebacks.length ? "bad" : "neutral", rows: comebacks, heading: "Comebacks", extra: { label: "Tests", value: tests } },
  ];
}

function StatusPill({ status }: { status: QcCheckBrief["status"] }) {
  const cls = status === "passed" ? "bg-emerald-50 text-emerald-800" : status === "closed" ? "bg-neutral-200 text-neutral-700" : "bg-red-50 text-red-700";
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${cls}`}>{status === "passed" ? "Passed" : status === "closed" ? "Closed as failed" : "Rework - waiting for retest"}</span>;
}

function Tile({ card, onOpen }: { card: Card; onOpen: () => void }) {
  const color = card.tone === "good" ? "text-emerald-700" : card.tone === "bad" ? "text-red-700" : "text-neutral-900";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className="group rounded-xl bg-white p-4 text-left shadow-sm ring-1 ring-neutral-200/70 transition hover:ring-brand/50 hover:shadow-md active:scale-[0.99]"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-neutral-500">{card.title}</div>
        <span className="text-neutral-300 transition group-hover:text-brand" aria-hidden="true">
          ›
        </span>
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{card.value}</div>
      <div className="mt-0.5 text-xs text-neutral-500">{card.sub}</div>
      <div className="mt-2 text-[11px] font-semibold text-brand opacity-0 transition group-hover:opacity-100">View work orders</div>
    </button>
  );
}

/** The work orders behind a card, in a window: WIP, QC number, vehicle, branch, status; each opens its QC. */
function Orders({ card, recordsHref, showBranch, onClose }: { card: Card; recordsHref: string; showBranch: boolean; onClose: () => void }) {
  const [showOther, setShowOther] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = before;
    };
  }, [onClose]);
  const rows = [...(showOther && card.other ? card.other.rows : card.rows)].sort(card.sort ?? byNewest);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={card.title} onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-neutral-500">{card.title}</div>
            <h2 className="text-lg font-bold text-neutral-900">
              {showOther && card.other ? card.other.label : card.heading} <span className="text-neutral-400">· {rows.length}</span>
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100">
            ✕
          </button>
        </div>
        {card.other && (
          <div className="flex gap-1 border-b border-neutral-100 px-5 py-2">
            <button type="button" onClick={() => setShowOther(false)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${!showOther ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>
              {card.heading} ({card.rows.length})
            </button>
            <button type="button" onClick={() => setShowOther(true)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${showOther ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>
              {card.other.label} ({card.other.rows.length})
            </button>
          </div>
        )}
        <div className="overflow-y-auto">
          {rows.length === 0 ? (
            <p className="p-8 text-center text-sm text-neutral-500">No work orders.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`${recordsHref}/${r.id}`} className="block px-5 py-3 hover:bg-neutral-50">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span className="font-semibold text-neutral-900">WIP {r.wip}</span>
                        <span className="text-xs text-neutral-500">{r.qcNo}</span>
                        <span className="text-xs text-neutral-500">{purposeLabel(r.purpose)}</span>
                      </div>
                      <StatusPill status={r.status} />
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-neutral-500">
                      {r.model && <span>{r.model}</span>}
                      {showBranch && <span>{r.branch}</span>}
                      {r.technicians.length > 0 && <span>{r.technicians.join(", ")}</span>}
                      {card.extra && (
                        <span className="font-semibold text-neutral-700">
                          {card.extra.label}: {card.extra.value(r)}
                        </span>
                      )}
                      <span>{fmtDate(r.createdAt)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** The quality KPI cards; click one to see the work orders behind its number. */
export function QcCards({ a, recordsHref, showBranches }: { a: QcAnalysis; recordsHref: string; showBranches: boolean }) {
  const cards = buildCards(a);
  const [open, setOpen] = useState<CardKey | null>(null);
  const card = cards.find((c) => c.key === open);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <Tile key={c.key} card={c} onOpen={() => setOpen(c.key)} />
        ))}
      </div>
      {card && <Orders card={card} recordsHref={recordsHref} showBranch={showBranches} onClose={() => setOpen(null)} />}
    </>
  );
}
