"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveWorkingHours, setReceiving } from "@/app/actions/queue";
import { DAY_NAMES, WEEK_ORDER, receivingText, type DayHours, type Override, type Receiving, type Schedule } from "@/lib/queue/hours";

const time = "h-9 rounded-lg border border-neutral-200 bg-white px-2 text-sm tabular-nums disabled:bg-neutral-50 disabled:text-neutral-400";

/**
 * The reception manager: receiving now (follow the hours, or open / closed for the rest of today) and the working hours
 * per day - first and last customer, and the break. The kiosk and the TV follow it.
 */
export function HoursForm({ branchId, schedule: initial, override, receiving }: { branchId: string; schedule: Schedule; override: Override; receiving: Receiving }) {
  const router = useRouter();
  const [days, setDays] = useState<Schedule>(initial);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const mode = override ?? "auto";
  const changed = JSON.stringify(days) !== JSON.stringify(initial);

  const set = (d: number, patch: Partial<DayHours>) => setDays((all) => all.map((x, i) => (i === d ? { ...x, ...patch } : x)));

  function switchTo(m: "auto" | "open" | "closed") {
    start(async () => {
      const r = await setReceiving(branchId, m);
      setMsg(r.error ? { text: r.error, bad: true } : null);
      router.refresh();
    });
  }

  return (
    <div className="max-w-3xl space-y-5">
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200/70">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-neutral-900">Receiving customers</h2>
            <p className={`mt-0.5 flex items-center gap-2 text-sm font-medium ${receiving.open ? "text-emerald-700" : "text-red-700"}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${receiving.open ? "bg-emerald-500" : "bg-red-500"}`} />
              {receivingText(receiving, "en")}
            </p>
          </div>
          <div className="flex rounded-xl bg-neutral-100 p-1" role="radiogroup" aria-label="Receiving">
            {(
              [
                ["auto", "Follow the hours"],
                ["open", "Open now"],
                ["closed", "Closed now"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                disabled={pending}
                onClick={() => switchTo(m)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  mode === m ? (m === "closed" ? "bg-red-600 text-white" : m === "open" ? "bg-emerald-600 text-white" : "bg-white text-neutral-900 shadow-sm") : "text-neutral-600 hover:text-neutral-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-3 text-xs text-neutral-500">Open now / Closed now last for today only; tomorrow the branch follows the working hours again. The kiosk and the TV show it.</p>
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200/70">
        <h2 className="font-semibold text-neutral-900">Working hours</h2>
        <p className="mb-3 text-sm text-neutral-500">When the kiosk takes new customers: the first and the last customer of the day, and the break.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-xs text-neutral-500">
              <tr>
                <th className="py-2 text-start font-medium">Day</th>
                <th className="py-2 text-start font-medium">Open</th>
                <th className="py-2 text-start font-medium">First customer</th>
                <th className="py-2 text-start font-medium">Last customer</th>
                <th className="py-2 text-start font-medium">Break</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {WEEK_ORDER.map((d) => {
                const x = days[d];
                return (
                  <tr key={d} className={x.open ? "" : "text-neutral-400"}>
                    <td className="py-2 font-medium text-neutral-800">{DAY_NAMES[d][0]}</td>
                    <td className="py-2">
                      <label className="inline-flex cursor-pointer items-center gap-2">
                        <input type="checkbox" checked={x.open} onChange={(e) => set(d, { open: e.target.checked })} className="h-4 w-4 accent-brand" />
                        <span className="text-xs">{x.open ? "Working" : "Day off"}</span>
                      </label>
                    </td>
                    <td className="py-2">
                      <input type="time" step={900} value={x.first} disabled={!x.open} onChange={(e) => set(d, { first: e.target.value })} className={time} />
                    </td>
                    <td className="py-2">
                      <input type="time" step={900} value={x.last} disabled={!x.open} onChange={(e) => set(d, { last: e.target.value })} className={time} />
                    </td>
                    <td className="py-2">
                      <span className="inline-flex items-center gap-1">
                        <input type="time" step={900} value={x.breakStart ?? ""} disabled={!x.open} onChange={(e) => set(d, { breakStart: e.target.value || null })} className={time} />
                        <span className="text-neutral-400">–</span>
                        <input type="time" step={900} value={x.breakEnd ?? ""} disabled={!x.open} onChange={(e) => set(d, { breakEnd: e.target.value || null })} className={time} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-neutral-500">No break on a day: clear both break times.</p>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled={pending || !changed}
            onClick={() =>
              start(async () => {
                const r = await saveWorkingHours(branchId, days);
                setMsg(r.error ? { text: r.error, bad: true } : { text: "Working hours saved." });
                router.refresh();
              })
            }
            className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save working hours"}
          </button>
          {changed && (
            <button type="button" onClick={() => setDays(initial)} className="text-sm font-semibold text-neutral-500 hover:underline">
              Undo changes
            </button>
          )}
          {msg && <span className={`text-sm ${msg.bad ? "text-red-600" : "text-emerald-700"}`}>{msg.text}</span>}
        </div>
      </section>
    </div>
  );
}
