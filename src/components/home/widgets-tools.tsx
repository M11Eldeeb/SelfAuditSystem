"use client";

// Productive and fun Home widgets. Each keeps what it must remember in its own `data` (saved on the account).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { pickOfTheDay, riyadhDay } from "@/lib/home/layout";
import { useNow } from "@/components/home/widgets-daily";

export type WidgetProps = { data: Record<string, unknown>; update: (patch: Record<string, unknown>) => void };

const btn = "rounded-full bg-neutral-900 px-3.5 py-1.5 text-[13px] font-semibold text-white transition active:scale-95 disabled:opacity-40";
const ghost = "rounded-full px-3 py-1.5 text-[13px] font-semibold text-neutral-600 transition hover:bg-neutral-900/[0.05] hover:text-neutral-900";
const input = "h-9 min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-2.5 text-[14px] text-neutral-900 focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none";
const newId = () => Math.random().toString(36).slice(2, 10);

// ---- sticky note -----------------------------------------------------------------------------------------------------------

const NOTE_COLORS = { yellow: "#fff3b0", pink: "#ffd6e0", blue: "#d6ebff", green: "#d8f5dc" } as const;
type NoteColor = keyof typeof NOTE_COLORS;

export function StickyWidget({ data, update }: WidgetProps) {
  const color = (typeof data.color === "string" && data.color in NOTE_COLORS ? data.color : "yellow") as NoteColor;
  const [text, setText] = useState(typeof data.text === "string" ? data.text : "");
  return (
    <div className="-m-5 flex h-[calc(100%+2.5rem)] min-h-48 flex-col rounded-[22px] p-4" style={{ background: NOTE_COLORS[color] }}>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          update({ text: e.target.value });
        }}
        maxLength={1500}
        placeholder="Write anything…"
        aria-label="Sticky note"
        className="min-h-32 flex-1 resize-none bg-transparent text-[15px] leading-relaxed text-neutral-900 placeholder:text-neutral-500 focus:outline-none"
      />
      <div className="mt-2 flex gap-1.5">
        {(Object.keys(NOTE_COLORS) as NoteColor[]).map((c) => (
          <button key={c} type="button" onClick={() => update({ color: c })} aria-label={`${c} note`} aria-pressed={c === color} className={`h-5 w-5 rounded-full ring-1 ring-black/15 ${c === color ? "outline-2 outline-offset-1 outline-neutral-700" : ""}`} style={{ background: NOTE_COLORS[c] }} />
        ))}
      </div>
    </div>
  );
}

// ---- to-do list ------------------------------------------------------------------------------------------------------------

type Todo = { id: string; text: string; done: boolean };

export function TodoWidget({ data, update }: WidgetProps) {
  const items = (Array.isArray(data.items) ? data.items : []) as Todo[];
  const [text, setText] = useState("");
  const set = (next: Todo[]) => update({ items: next.slice(0, 60) });
  const done = items.filter((i) => i.done).length;
  return (
    <div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          set([...items, { id: newId(), text: text.trim().slice(0, 200), done: false }]);
          setText("");
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a task" aria-label="New task" className={input} />
        <button type="submit" className={btn} disabled={!text.trim()}>
          Add
        </button>
      </form>
      {items.length === 0 ? (
        <p className="mt-3 text-[13px] text-neutral-500">Nothing on the list. Enjoy it.</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {items.map((t) => (
            <li key={t.id} className="group flex items-center gap-2.5 rounded-lg px-1 py-1 hover:bg-neutral-900/[0.03]">
              <input type="checkbox" checked={t.done} onChange={() => set(items.map((i) => (i.id === t.id ? { ...i, done: !i.done } : i)))} aria-label={t.text} className="h-4 w-4 accent-[var(--brand)]" />
              <span className={`min-w-0 flex-1 text-[14px] ${t.done ? "text-neutral-400 line-through" : "text-neutral-800"}`}>{t.text}</span>
              <button type="button" onClick={() => set(items.filter((i) => i.id !== t.id))} aria-label={`Delete ${t.text}`} className="text-neutral-400 opacity-0 group-hover:opacity-100 hover:text-red-600 focus:opacity-100">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {done > 0 && (
        <button type="button" onClick={() => set(items.filter((i) => !i.done))} className={`${ghost} mt-2 -ml-3`}>
          Clear {done} done
        </button>
      )}
    </div>
  );
}

// ---- focus timer -----------------------------------------------------------------------------------------------------------

export function FocusWidget({ data, update }: WidgetProps) {
  const [mode, setMode] = useState<"focus" | "rest">("focus");
  const [left, setLeft] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const today = riyadhDay();
  const sessions = data.day === today && typeof data.count === "number" ? data.count : 0;
  const ref = useRef({ mode, sessions, today, update });
  useEffect(() => {
    ref.current = { mode, sessions, today, update };
  });
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setLeft((s) => {
        if (s > 1) return s - 1;
        const { mode: m, sessions: n, today: d, update: save } = ref.current;
        if (m === "focus") queueMicrotask(() => save({ day: d, count: n + 1 }));
        setMode(m === "focus" ? "rest" : "focus");
        setRunning(false);
        return m === "focus" ? 5 * 60 : 25 * 60;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running]);
  const total = mode === "focus" ? 25 * 60 : 5 * 60;
  return (
    <div className="text-center">
      <p className={`text-[12px] font-bold tracking-[0.12em] uppercase ${mode === "focus" ? "text-brand" : "text-emerald-700"}`}>{mode === "focus" ? "Focus" : "Rest"}</p>
      <p className="mt-1 text-[44px] leading-none font-bold text-neutral-900 tabular-nums">
        {String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}
      </p>
      <div className="mx-auto mt-3 h-1.5 max-w-52 overflow-hidden rounded-full bg-neutral-900/[0.07]">
        <div className={`h-full rounded-full ${mode === "focus" ? "bg-brand" : "bg-emerald-600"}`} style={{ width: `${((total - left) / total) * 100}%` }} />
      </div>
      <div className="mt-4 flex justify-center gap-2">
        <button type="button" onClick={() => setRunning((r) => !r)} className={btn}>
          {running ? "Pause" : "Start"}
        </button>
        <button
          type="button"
          onClick={() => {
            setRunning(false);
            setLeft(total);
          }}
          className={ghost}
        >
          Reset
        </button>
      </div>
      <p className="mt-3 text-[12px] text-neutral-500">{sessions ? `${sessions} focus session${sessions > 1 ? "s" : ""} today - well done.` : "Your first focus session of the day is waiting."}</p>
    </div>
  );
}

// ---- clock -----------------------------------------------------------------------------------------------------------------

export function ClockWidget() {
  const now = useNow(1000);
  if (!now) return <div className="h-24" />;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }).format(now);
  return (
    <div>
      <p className="text-[13px] font-medium text-neutral-500">Saudi Arabia</p>
      <p className="mt-1 text-[36px] leading-none font-bold text-neutral-900 tabular-nums">{time}</p>
      <p className="mt-2 text-[14px] text-neutral-700">{new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now)}</p>
      <p className="text-[13px] text-neutral-500">{new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { timeZone: "Asia/Riyadh", day: "numeric", month: "long", year: "numeric" }).format(now)}</p>
    </div>
  );
}

// ---- quick links -----------------------------------------------------------------------------------------------------------

type QuickLink = { id: string; label: string; url: string };
const safeUrl = (u: string) => {
  const v = u.trim();
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  try {
    const url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
};

export function LinksWidget({ data, update }: WidgetProps) {
  const items = (Array.isArray(data.items) ? data.items : []) as QuickLink[];
  const [adding, setAdding] = useState(items.length === 0);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const good = safeUrl(url);
  return (
    <div>
      {items.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {items.map((l) => (
            <li key={l.id} className="group relative">
              {l.url.startsWith("/") ? (
                <Link href={l.url} className="block rounded-full bg-neutral-900/[0.05] px-3.5 py-1.5 text-[13px] font-semibold text-neutral-800 hover:bg-neutral-900/[0.09]">
                  {l.label}
                </Link>
              ) : (
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="block rounded-full bg-neutral-900/[0.05] px-3.5 py-1.5 text-[13px] font-semibold text-neutral-800 hover:bg-neutral-900/[0.09]">
                  {l.label} ↗
                </a>
              )}
              <button type="button" onClick={() => update({ items: items.filter((i) => i.id !== l.id) })} aria-label={`Remove ${l.label}`} className="absolute -top-1.5 -right-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-neutral-700 text-[11px] text-white group-hover:flex">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!good || !label.trim()) return;
            update({ items: [...items, { id: newId(), label: label.trim().slice(0, 40), url: good }].slice(0, 30) });
            setLabel("");
            setUrl("");
            setAdding(false);
          }}
        >
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name, e.g. AMS portal" aria-label="Link name" className={`${input} w-full`} />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Address, e.g. /admin/query or a website" aria-label="Link address" className={`${input} w-full`} />
          <div className="flex gap-2">
            <button type="submit" className={btn} disabled={!good || !label.trim()}>
              Add link
            </button>
            {items.length > 0 && (
              <button type="button" onClick={() => setAdding(false)} className={ghost}>
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={`${ghost} mt-2 -ml-3`}>
          + Add a link
        </button>
      )}
    </div>
  );
}

// ---- weekend countdown -----------------------------------------------------------------------------------------------------

export function CountdownWidget() {
  const now = useNow(1000);
  if (!now) return <div className="h-20" />;
  // Saudi time is UTC+3 all year. The week ends Thursday 13:30; Friday and Saturday are the weekend.
  const r = new Date(now.getTime() + 3 * 3_600_000);
  const dow = r.getUTCDay();
  const minutes = r.getUTCHours() * 60 + r.getUTCMinutes();
  if (dow === 5 || dow === 6 || (dow === 4 && minutes >= 13 * 60 + 30))
    return (
      <div>
        <p className="text-[28px] font-bold text-neutral-900">It&apos;s the weekend!</p>
        <p className="mt-1 text-[14px] text-neutral-600">Rest well - you earned it.</p>
      </div>
    );
  const end = Date.UTC(r.getUTCFullYear(), r.getUTCMonth(), r.getUTCDate() + ((4 - dow + 7) % 7), 13, 30);
  const s = Math.max(0, Math.floor((end - r.getTime()) / 1000));
  const parts = [
    [Math.floor(s / 86400), "days"],
    [Math.floor((s % 86400) / 3600), "hours"],
    [Math.floor((s % 3600) / 60), "min"],
    [s % 60, "sec"],
  ] as const;
  return (
    <div>
      <ul className="grid grid-cols-4 gap-2 text-center">
        {parts.map(([v, l]) => (
          <li key={l} className="rounded-xl bg-neutral-900/[0.04] py-2">
            <span className="block text-[24px] leading-none font-bold text-neutral-900 tabular-nums">{v}</span>
            <span className="mt-1 block text-[11px] font-semibold text-neutral-500">{l}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] text-neutral-600">Until Thursday 1:30 pm. Keep going!</p>
    </div>
  );
}

// ---- water tracker ---------------------------------------------------------------------------------------------------------

export function WaterWidget({ data, update }: WidgetProps) {
  const today = riyadhDay();
  const count = data.day === today && typeof data.count === "number" ? data.count : 0;
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 8 }, (_, i) => (
          <button key={i} type="button" onClick={() => update({ day: today, count: i < count ? i : i + 1 })} aria-label={`Glass ${i + 1}${i < count ? ", drunk" : ""}`} className="transition active:scale-90">
            <svg width="28" height="34" viewBox="0 0 28 34" aria-hidden="true">
              <path d="M4 3h20l-2.5 27a2 2 0 01-2 1.8H8.5a2 2 0 01-2-1.8z" fill={i < count ? "#5b9ef0" : "none"} stroke={i < count ? "#3b7fd6" : "#c4c4c4"} strokeWidth="1.6" />
            </svg>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[14px] text-neutral-700">{count >= 8 ? "All eight glasses - great job staying fresh!" : `${count} of 8 glasses today.`}</p>
    </div>
  );
}

// ---- breathe ---------------------------------------------------------------------------------------------------------------

const PHASES = [
  { text: "Breathe in", scale: 1 },
  { text: "Hold", scale: 1 },
  { text: "Breathe out", scale: 0.55 },
  { text: "Hold", scale: 0.55 },
];

export function BreatheWidget() {
  const [step, setStep] = useState<number | null>(null);
  useEffect(() => {
    if (step === null) return;
    if (step >= 16) {
      const done = setTimeout(() => setStep(null), 0);
      return () => clearTimeout(done);
    }
    const id = setTimeout(() => setStep(step + 1), 4000);
    return () => clearTimeout(id);
  }, [step]);
  const phase = step === null ? null : PHASES[step % 4];
  return (
    <div className="flex flex-col items-center py-2">
      <div className="flex h-36 w-36 items-center justify-center">
        <div
          className="flex h-36 w-36 items-center justify-center rounded-full bg-sky-400/25 ring-8 ring-sky-400/10 transition-transform duration-[4000ms] ease-in-out motion-reduce:transition-none"
          style={{ transform: `scale(${phase?.scale ?? 0.55})` }}
        />
        <span className="absolute text-[15px] font-semibold text-neutral-800">{phase?.text ?? ""}</span>
      </div>
      <button type="button" onClick={() => setStep(step === null ? 0 : null)} className={`${btn} mt-2`}>
        {step === null ? "Start one calm minute" : "Stop"}
      </button>
    </div>
  );
}

// ---- car fact --------------------------------------------------------------------------------------------------------------

const FACTS = [
  "The first car radio appeared in the 1930s - drivers had to stop to tune it properly.",
  "A modern car can have more than 100 small computers (ECUs) talking to each other.",
  "The average car is made of around 30,000 parts, counting every bolt.",
  "Seat belts became standard in many cars only in the late 1960s.",
  "MG stands for Morris Garages, founded in Oxford, England, in the 1920s.",
  "Windscreen wipers were invented by Mary Anderson in 1903.",
  "Tyre tread wears faster in heat - hot Saudi roads make pressure checks extra important.",
  "Engine oil does more than lubricate: it also cools, cleans and seals.",
  "ABS lets you steer while braking hard by stopping the wheels from locking.",
  "An electric motor delivers its full torque from zero rpm - that is why EVs feel so quick.",
  "The 'check engine' light can be triggered by something as small as a loose fuel cap.",
  "Brake fluid absorbs water over time, which lowers its boiling point.",
  "Regenerative braking lets hybrids and EVs turn stopping into stored energy.",
  "Cruise control was invented by Ralph Teetor, an engineer who was blind.",
  "A car battery works harder in heat than in cold - heat shortens its life.",
  "Airbags inflate in about 30 milliseconds, faster than a blink.",
  "Diagnostic trouble codes (DTCs) follow a shared standard called OBD-II.",
  "The first speeding ticket was given in 1896 - for about 13 km/h.",
  "Turbochargers use exhaust gas to spin a turbine that pushes more air into the engine.",
  "A well-aligned car saves fuel and tyres - misalignment can wear a tyre in months.",
  "Coolant is a mix of water and glycol: it keeps engines from overheating and freezing.",
  "Modern cars can update some software over the air, like a phone.",
  "Rear-view mirrors first showed up in racing cars in 1911.",
  "Most car horns are tuned to the musical notes F and A.",
  "A warranty claim with clear photos and DTCs is approved faster - details matter!",
];

export function CarFactWidget() {
  const [extra, setExtra] = useState(0);
  const base = FACTS.indexOf(pickOfTheDay(FACTS));
  return (
    <div>
      <p className="text-[16px] leading-relaxed text-neutral-800">{FACTS[(base + extra) % FACTS.length]}</p>
      <button type="button" onClick={() => setExtra((e) => e + 1)} className={`${ghost} mt-3 -ml-3`}>
        Another fact →
      </button>
    </div>
  );
}

// ---- dice & coin -----------------------------------------------------------------------------------------------------------

const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
};

function Die({ value }: { value: number }) {
  return (
    <svg width="54" height="54" viewBox="0 0 54 54" aria-label={`Die showing ${value}`}>
      <rect x="2" y="2" width="50" height="50" rx="12" fill="white" stroke="#d4d4d4" strokeWidth="2" />
      {PIPS[value].map(([r, c], i) => (
        <circle key={i} cx={13 + c * 14} cy={13 + r * 14} r="4.5" fill="var(--brand)" />
      ))}
    </svg>
  );
}

export function DiceWidget() {
  const [dice, setDice] = useState<[number, number] | null>(null);
  const [coin, setCoin] = useState<string | null>(null);
  const roll = () => 1 + Math.floor(Math.random() * 6);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {dice ? (
          <>
            <Die value={dice[0]} />
            <Die value={dice[1]} />
            <span className="text-[15px] font-semibold text-neutral-800">= {dice[0] + dice[1]}</span>
          </>
        ) : (
          <span className="text-[14px] text-neutral-500">Two dice, ready to roll.</span>
        )}
        <button type="button" onClick={() => setDice([roll(), roll()])} className={`${btn} ml-auto`}>
          Roll
        </button>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[15px] font-semibold text-neutral-800">{coin ?? "Heads or tails?"}</span>
        <button type="button" onClick={() => setCoin(Math.random() < 0.5 ? "Heads" : "Tails")} className={`${btn} ml-auto`}>
          Flip a coin
        </button>
      </div>
    </div>
  );
}
