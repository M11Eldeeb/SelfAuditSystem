"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

type Cell = string | number | boolean | null;
type Table = { title: string; columns: string[]; rows: Cell[][] };
type Proposal = { token: string; summary: string; state?: "running" | "done" | "failed" | "cancelled"; result?: string };
type Msg = { role: "user" | "assistant"; text: string; tables?: Table[]; proposals?: Proposal[]; error?: boolean };

const STORE = "mg-assistant-chat";
const SUGGESTIONS = [
  "How many open WIPs per branch, and which are older than 30 days?",
  "Which courtesy cars are overdue?",
  "Warranty KPIs this month per branch",
  "كم شكوى مفتوحة لكل فرع؟",
];

const isArabic = (s: string) => /[؀-ۿ]/.test(s);

// ---------- small, safe markdown (no HTML injection: everything is React text) ----------

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith("**") ? <strong key={i++}>{t.slice(2, -2)}</strong> : <code key={i++} className="rounded bg-neutral-100 px-1 text-[0.85em]">{t.slice(1, -1)}</code>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:-]+\|/.test(lines[i + 1])) {
      const head = cells(line);
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) body.push(cells(lines[i++]));
      blocks.push(
        <div key={k++} className="my-2 overflow-x-auto rounded-lg border border-neutral-200">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50 text-neutral-600"><tr>{head.map((h, j) => <th key={j} className="px-2 py-1.5 text-start font-semibold">{inline(h)}</th>)}</tr></thead>
            <tbody>{body.map((r, j) => <tr key={j} className="border-t border-neutral-100">{r.map((c, n) => <td key={n} className="px-2 py-1.5 tabular-nums">{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+\.)\s+/, ""));
      const L = ordered ? "ol" : "ul";
      blocks.push(<L key={k++} className={`my-1.5 space-y-0.5 ps-5 ${ordered ? "list-decimal" : "list-disc"}`}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</L>);
      continue;
    }
    const h = /^#{1,4}\s+(.*)/.exec(line);
    if (h) { blocks.push(<p key={k++} className="mt-2 mb-1 font-semibold">{inline(h[1])}</p>); i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(\||[-*•]\s|\d+\.\s|#)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    blocks.push(<p key={k++} className="my-1.5">{para.map((p, j) => <Fragment key={j}>{j > 0 && <br />}{inline(p)}</Fragment>)}</p>);
  }
  return <>{blocks}</>;
}

// ---------- tables with CSV ----------

function downloadCsv(t: Table) {
  const esc = (v: Cell) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [t.columns, ...t.rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${t.title.replace(/[^\w؀-ۿ -]+/g, "").trim() || "report"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const label = (c: string) => c.replace(/_/g, " ");
const show = (v: Cell) => (v == null ? "" : typeof v === "boolean" ? (v ? "Yes" : "No") : typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : v);

function ResultTableView({ t }: { t: Table }) {
  const [all, setAll] = useState(false);
  const rows = all ? t.rows : t.rows.slice(0, 10);
  return (
    <div className="mt-2 rounded-lg border border-neutral-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-2.5 py-1.5">
        <span className="truncate text-xs font-semibold text-neutral-700">{t.title} <span className="font-normal text-neutral-400">({t.rows.length})</span></span>
        <button type="button" onClick={() => downloadCsv(t)} className="shrink-0 rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-semibold text-white hover:bg-neutral-700">Download CSV</button>
      </div>
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-neutral-50 text-neutral-500"><tr>{t.columns.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1 text-start font-semibold capitalize">{label(c)}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-neutral-100">{r.map((v, j) => <td key={j} className="whitespace-nowrap px-2 py-1 tabular-nums">{show(v)}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {t.rows.length > 10 && (
        <button type="button" onClick={() => setAll(!all)} className="w-full border-t border-neutral-100 py-1 text-[11px] font-semibold text-brand hover:bg-neutral-50">{all ? "Show less" : `Show all ${t.rows.length}`}</button>
      )}
    </div>
  );
}

// ---------- the widget ----------

export function AssistantWidget({ firstName }: { firstName: string }) {
  const [open, setOpen] = useState(false);
  // The chat of this tab survives page changes. Read once on the client; nothing of it is drawn until the panel opens,
  // so the server render (closed) matches.
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(sessionStorage.getItem(STORE) ?? "[]") as Msg[];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify(msgs.slice(-40))); } catch {}
    end.current?.scrollIntoView({ block: "end" });
  }, [msgs, busy]);
  useEffect(() => { if (open) box.current?.focus(); }, [open]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const history = msgs.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ history, message: q }) });
      const data = (await res.json().catch(() => ({}))) as { answer?: string; tables?: Table[]; proposals?: Proposal[]; error?: string };
      setMsgs((m) => [...m, data.answer ? { role: "assistant", text: data.answer, tables: data.tables, proposals: data.proposals } : { role: "assistant", text: data.error ?? "Something went wrong. Try again.", error: true }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", text: "No connection. Try again.", error: true }]);
    } finally {
      setBusy(false);
    }
  }

  function setProposal(mi: number, pi: number, patch: Partial<Proposal>) {
    setMsgs((m) => m.map((x, i) => (i !== mi ? x : { ...x, proposals: x.proposals?.map((p, j) => (j === pi ? { ...p, ...patch } : p)) })));
  }

  async function confirm(mi: number, pi: number, p: Proposal) {
    setProposal(mi, pi, { state: "running" });
    try {
      const res = await fetch("/api/assistant/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: p.token }) });
      const r = (await res.json().catch(() => ({ ok: false, message: "Failed." }))) as { ok: boolean; message: string };
      setProposal(mi, pi, { state: r.ok ? "done" : "failed", result: r.message });
    } catch {
      setProposal(mi, pi, { state: "failed", result: "No connection. Try again." });
    }
  }

  return (
    <div className="print:hidden">
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Morris, the MG portal assistant"
          className="fixed bottom-5 end-5 z-50 flex items-center gap-2 rounded-full bg-brand py-3 ps-3.5 pe-4 text-sm font-semibold text-white shadow-lg shadow-black/20 transition hover:bg-brand-dark hover:shadow-xl"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
            <path d="M8.5 11h.01M12 11h.01M15.5 11h.01" />
          </svg>
          Ask Morris
        </button>
      )}

      {open && (
        <div className="fixed inset-x-2 bottom-2 top-16 z-50 flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 shadow-2xl shadow-black/25 sm:inset-x-auto sm:end-5 sm:bottom-5 sm:top-auto sm:h-[min(640px,calc(100vh-6rem))] sm:w-[420px]">
          <div className="flex items-center gap-2 bg-brand-ink px-4 py-3 text-white">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Morris <span className="font-normal text-white/60">· MG portal assistant</span></p>
              <p className="truncate text-[11px] text-white/60">Named after Morris Garages, where MG began · English or Arabic</p>
            </div>
            {msgs.length > 0 && (
              <button type="button" onClick={() => setMsgs([])} disabled={busy} className="rounded-md px-2 py-1 text-[11px] font-semibold text-white/80 hover:bg-white/10 disabled:opacity-40">New chat</button>
            )}
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-md p-1 text-white/80 hover:bg-white/10">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm text-neutral-800">
            {msgs.length === 0 && (
              <div className="px-1 pt-2">
                <p className="font-semibold text-neutral-900">Hello {firstName}, I&apos;m Morris 👋</p>
                <p className="mt-1 text-[13px] text-neutral-600">Ask about open WIPs, warranty KPIs, complaints, courtesy cars, the customer queue or technician claims. I can also make a list you can download, or prepare a change for you to confirm.</p>
                <div className="mt-3 space-y-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} dir={isArabic(s) ? "rtl" : "ltr"} className="block w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-start text-[13px] text-neutral-700 hover:border-brand/40 hover:text-neutral-900">{s}</button>
                  ))}
                </div>
              </div>
            )}

            {msgs.map((m, mi) =>
              m.role === "user" ? (
                <div key={mi} className="flex justify-end">
                  <div dir={isArabic(m.text) ? "rtl" : "ltr"} className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-ee-md bg-brand px-3 py-2 text-white">{m.text}</div>
                </div>
              ) : (
                <div key={mi} dir={isArabic(m.text) ? "rtl" : "ltr"} className={`rounded-2xl rounded-es-md border px-3 py-2 ${m.error ? "border-red-200 bg-red-50 text-red-700" : "border-neutral-200 bg-white"}`}>
                  <Markdown text={m.text} />
                  {m.tables?.map((t, i) => <ResultTableView key={i} t={t} />)}
                  {m.proposals?.map((p, pi) => (
                    <div key={pi} dir="ltr" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Needs your confirmation</p>
                      <p className="mt-1 text-[13px] text-neutral-800">{p.summary}</p>
                      {!p.state || p.state === "running" ? (
                        <div className="mt-2 flex gap-2">
                          <button type="button" disabled={p.state === "running"} onClick={() => confirm(mi, pi, p)} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-50">{p.state === "running" ? "Working…" : "Confirm"}</button>
                          <button type="button" disabled={p.state === "running"} onClick={() => setProposal(mi, pi, { state: "cancelled" })} className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">Cancel</button>
                        </div>
                      ) : (
                        <p className={`mt-1.5 text-xs font-semibold ${p.state === "done" ? "text-emerald-700" : p.state === "failed" ? "text-red-700" : "text-neutral-500"}`}>
                          {p.state === "done" ? `✓ ${p.result}` : p.state === "failed" ? p.result : "Cancelled - nothing was changed."}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ),
            )}

            {busy && (
              <div className="flex items-center gap-2 px-1 text-xs text-neutral-500">
                <span className="flex gap-1">
                  {[0, 150, 300].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400" style={{ animationDelay: `${d}ms` }} />)}
                </span>
                Looking at the portal data…
              </div>
            )}
            <div ref={end} />
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); send(input); }}
            className="flex items-end gap-2 border-t border-neutral-200 bg-white p-2.5"
          >
            <textarea
              ref={box}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              dir={isArabic(input) ? "rtl" : "ltr"}
              rows={1}
              maxLength={4000}
              placeholder="Ask a question… / اكتب سؤالك…"
              className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white hover:bg-brand-dark disabled:opacity-40">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </form>
          <p className="bg-white px-3 pb-2 text-center text-[10px] text-neutral-400">Answers come from the portal data; check important figures before you act on them.</p>
        </div>
      )}
    </div>
  );
}
