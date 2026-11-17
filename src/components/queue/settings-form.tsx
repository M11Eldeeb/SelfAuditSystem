"use client";

import { useState, useTransition } from "react";
import { saveQueueSettings } from "@/app/actions/queue";
import { TIER_LABEL, type QueueSettings, type Tier } from "@/lib/queue/core";

/** How "Call next customer" picks in this branch: the order of the service types and the Quick Service fairness. */
export function SettingsForm({ branchId, initial, updated }: { branchId: string; initial: QueueSettings; updated: string | null }) {
  const [order, setOrder] = useState<Tier[]>(initial.priority_order);
  const [fair, setFair] = useState(initial.fairness_enabled);
  const [minutes, setMinutes] = useState(initial.fairness_override_minutes);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, start] = useTransition();

  const move = (i: number, d: -1 | 1) =>
    setOrder((o) => {
      const j = i + d;
      if (j < 0 || j >= o.length) return o;
      const n = [...o];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-sm text-neutral-600">How Call next customer picks who is next in this branch only. A reserved (urgent) customer and a customer back from hold always come first.</p>
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200/70">
        <h2 className="font-semibold text-neutral-900">Order of service types</h2>
        <p className="mb-3 text-sm text-neutral-500">The first type with someone waiting is called first (oldest first within a type).</p>
        <ol className="space-y-2">
          {order.map((tier, i) => (
            <li key={tier} className="flex items-center gap-3 rounded-xl border border-neutral-200 px-3 py-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">{i + 1}</span>
              <span className="flex-1 text-sm font-medium text-neutral-900">{TIER_LABEL[tier][0]}</span>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="h-8 w-8 rounded-lg bg-neutral-100 text-sm disabled:opacity-30" aria-label="Up">
                ↑
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1} className="h-8 w-8 rounded-lg bg-neutral-100 text-sm disabled:opacity-30" aria-label="Down">
                ↓
              </button>
            </li>
          ))}
        </ol>
      </section>
      <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200/70">
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={fair} onChange={(e) => setFair(e.target.checked)} className="mt-1 accent-brand" />
          <span>
            <span className="font-semibold text-neutral-900">Share Quick Service fairly</span>
            <span className="block text-sm text-neutral-500">Quick Service carries an incentive: the advisor with the fewest Quick Service customers today takes the next one.</span>
          </span>
        </label>
        {fair && (
          <label className="flex flex-wrap items-center gap-2 text-sm text-neutral-700">
            Unless the customer has waited more than
            <input
              type="number"
              min={0}
              max={240}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="h-9 w-20 rounded-lg border border-neutral-200 px-2 text-center"
            />
            minutes - then the next advisor takes them.
          </label>
        )}
      </section>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveQueueSettings(branchId, order, fair, minutes);
              setMsg(r.error ? { text: r.error, bad: true } : { text: "Saved." });
            })
          }
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save settings"}
        </button>
        {msg && <span className={`text-sm ${msg.bad ? "text-red-600" : "text-emerald-700"}`}>{msg.text}</span>}
        {updated && !msg && <span className="text-xs text-neutral-400">{updated}</span>}
      </div>
    </div>
  );
}
