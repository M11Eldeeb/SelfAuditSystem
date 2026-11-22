"use client";

// The standard Home widgets (the Sub-Dealer Warranty Desk's three: reminder, weather, calendar) and the role's numbers.
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { pickOfTheDay, riyadhDay } from "@/lib/home/layout";
import type { HomeKpis } from "@/lib/home/kpis";

/** The time, ticking every `ms` (null until the page is in the browser, so the server and the browser draw the same). */
export function useNow(ms = 1000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNow(new Date()), 0);
    const id = setInterval(() => setNow(new Date()), ms);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [ms]);
  return now;
}

// ---- my numbers ------------------------------------------------------------------------------------------------------------

/**
 * The role's figures as big numbers on white cards, in the site's red, white and black. The cards share each row
 * between them (a short last row stretches), so the block is always a full rectangle.
 */
export function KpisWidget({ kpis }: { kpis: HomeKpis }) {
  return (
    <div>
      <h2 className="mb-3 text-[15px] font-semibold text-neutral-900">{kpis.title}</h2>
      {!kpis.items.length ? (
        <p className="rounded-[22px] bg-[var(--surface)] p-5 text-[14px] text-neutral-500 ring-1 ring-neutral-900/[0.07]">No figures yet for your work - they appear here once there is something to count.</p>
      ) : (
        <ul className="flex flex-wrap gap-4">
          {kpis.items.map((k, i) => {
            const body = (
              <>
                <span className="flex items-start gap-2">
                  <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${k.tone === "bad" ? "bg-brand" : "bg-neutral-900"}`} />
                  <span className="text-[13px] font-semibold text-neutral-600">{k.label}</span>
                </span>
                <span className={`mt-auto block pt-3 text-[30px] leading-none font-bold tabular-nums ${k.tone === "bad" ? "text-brand" : "text-neutral-900"}`}>{k.value}</span>
                <span className="mt-2 block min-h-[1.125rem] text-[12px] text-neutral-500">{k.note ?? ""}</span>
              </>
            );
            const cls = "home-rise flex h-full flex-col rounded-[22px] bg-[var(--surface)] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_30px_-18px_rgba(0,0,0,0.25)] ring-1 ring-neutral-900/[0.07] transition";
            const style = { animationDelay: `${i * 60}ms` };
            return (
              <li key={k.label} className="min-w-0 flex-[1_1_13rem]">
                {k.href ? (
                  <Link href={k.href} className={`${cls} hover:-translate-y-0.5 hover:ring-neutral-900/20`} style={style}>
                    {body}
                  </Link>
                ) : (
                  <div className={cls} style={style}>
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---- today's reminder ------------------------------------------------------------------------------------------------------

const MESSAGES = [
  "Small steps every day add up to big results.",
  "Calm minds fix more than rushed ones.",
  "You are doing better than you think.",
  "Progress, not perfection.",
  "Be the reason a customer drives away happy.",
  "Every claim solved is a driver back on the road.",
  "Start where you are. Use what you have. Do what you can.",
  "A good team makes hard days feel lighter.",
  "Kind words cost nothing and mean everything.",
  "Focus on the next right step.",
  "Great work is built one detail at a time.",
  "Smile. It changes the whole workshop.",
  "Gratitude turns a busy day into a good one.",
  "Your effort today is tomorrow's easy day.",
  "Be patient with yourself, and generous with others.",
  "Hard days build the strongest teams.",
  "The best time to follow up was yesterday. The next best is now.",
  "Make today count.",
  "Good things take time. Keep going.",
  "Energy flows where focus goes.",
  "Courage is simply the next small action.",
  "A tidy list is a calm mind.",
  "Every expert was once a beginner.",
  "Quality is doing it right when no one is watching.",
  "Breathe. You have handled harder days than this.",
  "The little things are the big things.",
  "Teamwork turns promises into results.",
  "Be proud of how far you have come.",
  "Honesty and speed make the best pair.",
  "Take a sip of water, stretch, and carry on.",
  "Be the calm in someone else's busy day.",
  "Each day is a fresh page. Write something good.",
  "Success is a habit, not a moment.",
  "Dream big, start small, begin today.",
  "Work hard, be kind, and good things follow.",
  "You are the heart of this team.",
  "Celebrate the small wins. They add up.",
  "Stay curious, stay humble, stay moving.",
];

export function ReminderWidget() {
  return (
    <div className="relative -m-5 h-[calc(100%+2.5rem)] overflow-hidden rounded-[22px] p-5 text-white" style={{ background: "linear-gradient(140deg, #e0303a 0%, var(--brand) 55%, #8a0c12 100%)" }}>
      <span aria-hidden="true" className="absolute -top-10 -right-8 h-40 w-40 rounded-full bg-white/10" />
      <span aria-hidden="true" className="absolute right-2 -bottom-14 h-32 w-32 rounded-full bg-black/10" />
      <div className="relative">
        <p className="text-[11px] font-bold tracking-[0.14em] text-white/80 uppercase">Today&apos;s reminder</p>
        <p className="mt-3 text-[21px] leading-snug font-bold tracking-tight">{pickOfTheDay(MESSAGES)}</p>
      </div>
    </div>
  );
}

// ---- weather ---------------------------------------------------------------------------------------------------------------

type Weather = { temp: number; humidity: number; wind: number; code: number; days: { date: string; code: number; max: number; min: number }[] };

function describe(code: number): { kind: "sun" | "part" | "cloud" | "rain" | "storm" | "fog"; text: string } {
  if (code <= 1) return { kind: "sun", text: code === 0 ? "Clear sky" : "Mostly clear" };
  if (code === 2) return { kind: "part", text: "Partly cloudy" };
  if (code === 45 || code === 48) return { kind: "fog", text: "Fog" };
  if (code >= 51 && code <= 82) return { kind: "rain", text: code <= 57 ? "Drizzle" : "Rain" };
  if (code >= 95) return { kind: "storm", text: "Thunderstorm" };
  return { kind: "cloud", text: "Cloudy" };
}

function WeatherIcon({ kind, size }: { kind: ReturnType<typeof describe>["kind"]; size: number }) {
  const sun = <circle cx="12" cy="12" r="4.5" fill="#f5a524" />;
  const rays = <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" stroke="#f5a524" strokeWidth="1.6" strokeLinecap="round" />;
  const cloud = <path d="M7.5 18.5h9a3.5 3.5 0 000-7 5 5 0 00-9.6-1.3A3.9 3.9 0 007.5 18.5z" fill="#9db4d8" />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {kind === "sun" && (
        <>
          {sun}
          {rays}
        </>
      )}
      {kind === "part" && (
        <>
          <g transform="translate(-3 -3)">{sun}</g>
          {cloud}
        </>
      )}
      {(kind === "cloud" || kind === "fog") && cloud}
      {(kind === "rain" || kind === "storm") && (
        <>
          {cloud}
          <path d={kind === "rain" ? "M9 20.5l-1 2M13 20.5l-1 2M17 20.5l-1 2" : "M12.5 19l-2 3h2.5l-1.5 2.5"} stroke="#5b8def" strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export function WeatherWidget() {
  const [w, setW] = useState<Weather | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem("home-weather") ?? "null");
      if (saved && Date.now() - saved.at < 15 * 60_000) {
        queueMicrotask(() => alive && setW(saved.data));
        return () => {
          alive = false;
        };
      }
    } catch {
      // nothing kept
    }
    fetch("https://api.open-meteo.com/v1/forecast?latitude=21.4858&longitude=39.1925&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Asia%2FRiyadh&forecast_days=4")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (!alive) return;
        const data: Weather = {
          temp: d.current.temperature_2m,
          humidity: d.current.relative_humidity_2m,
          wind: d.current.wind_speed_10m,
          code: d.current.weather_code,
          days: d.daily.time.map((t: string, i: number) => ({ date: t, code: d.daily.weather_code[i], max: d.daily.temperature_2m_max[i], min: d.daily.temperature_2m_min[i] })),
        };
        setW(data);
        try {
          sessionStorage.setItem("home-weather", JSON.stringify({ at: Date.now(), data }));
        } catch {
          // private window
        }
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (failed) return <p className="text-[14px] text-neutral-500">The weather is not available right now.</p>;
  if (!w) return <div className="h-32 animate-pulse rounded-xl bg-neutral-900/[0.05]" />;
  const now = describe(w.code);
  return (
    <div>
      <p className="text-[13px] font-medium text-neutral-500">Jeddah</p>
      <div className="mt-1 flex items-center justify-between gap-3">
        <div>
          <p className="text-[38px] leading-none font-bold text-neutral-900 tabular-nums">{Math.round(w.temp)}°</p>
          <p className="mt-1 text-[14px] font-medium text-neutral-700">{now.text}</p>
        </div>
        <WeatherIcon kind={now.kind} size={52} />
      </div>
      <p className="mt-2 flex gap-4 text-[12px] text-neutral-600">
        <span>Humidity {Math.round(w.humidity)}%</span>
        <span>Wind {Math.round(w.wind)} km/h</span>
        <span className="ml-auto font-medium">
          H {Math.round(w.days[0].max)}° · L {Math.round(w.days[0].min)}°
        </span>
      </p>
      <ul className="mt-3 grid grid-cols-3 gap-2">
        {w.days.slice(1, 4).map((d) => (
          <li key={d.date} className="rounded-xl bg-sky-500/[0.07] px-2 py-1.5 text-center">
            <p className="text-[11px] font-semibold text-neutral-500">{new Date(`${d.date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" })}</p>
            <span className="my-0.5 flex justify-center">
              <WeatherIcon kind={describe(d.code).kind} size={20} />
            </span>
            <p className="text-[11px] font-semibold text-neutral-900 tabular-nums">
              {Math.round(d.max)}° <span className="text-neutral-500">{Math.round(d.min)}°</span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- calendar --------------------------------------------------------------------------------------------------------------

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const hijri = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Riyadh" });

export function CalendarWidget({ notes, onNote }: { notes: Record<string, string>; onNote: (day: string, text: string) => void }) {
  const now = useNow(60_000);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const today = now ? riyadhDay(now).split("-").map(Number) : null;
  const base = today ?? [2026, 1, 0];
  const first = new Date(Date.UTC(base[0], base[1] - 1 + offset, 1));
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(first.getUTCDay()).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const key = (d: number) => `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const isToday = (d: number) => !!today && d === today[2] && month + 1 === today[1] && year === today[0];
  const title = new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[15px] font-semibold text-neutral-900">{now ? title : " "}</p>
          {now && offset === 0 && <p className="mt-0.5 text-[12px] text-neutral-500">{hijri.format(now)}</p>}
        </div>
        <div className="flex items-center gap-0.5">
          {offset !== 0 && (
            <button type="button" onClick={() => setOffset(0)} className="rounded-lg px-2 py-1 text-[12px] font-semibold text-brand hover:bg-neutral-900/[0.05]">
              Today
            </button>
          )}
          <button type="button" onClick={() => setOffset((o) => o - 1)} aria-label="Previous month" className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-900/[0.05]">
            ‹
          </button>
          <button type="button" onClick={() => setOffset((o) => o + 1)} aria-label="Next month" className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-900/[0.05]">
            ›
          </button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-y-0.5 text-center">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className={`pb-0.5 text-[11px] font-semibold ${i >= 5 ? "text-neutral-400" : "text-neutral-500"}`}>
            {w}
          </span>
        ))}
        {cells.map((d, i) =>
          d ? (
            <span key={i} className="flex items-center justify-center">
              <button
                type="button"
                onClick={() => setOpen(key(d))}
                title={notes[key(d)] ?? "Add a note"}
                aria-label={`${d} ${title}${notes[key(d)] ? ", has a note" : ""}`}
                className={`relative flex h-7 w-8 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums transition-colors ${
                  isToday(d) ? "bg-brand text-white" : i % 7 >= 5 ? "text-neutral-400 hover:bg-neutral-900/[0.05]" : "text-neutral-800 hover:bg-neutral-900/[0.05]"
                } ${notes[key(d)] && !isToday(d) ? "ring-2 ring-amber-400/70" : ""}`}
              >
                {d}
                {notes[key(d)] && <span aria-hidden="true" className={`absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full ${isToday(d) ? "bg-white" : "bg-amber-500"}`} />}
              </button>
            </span>
          ) : (
            <span key={i} />
          )
        )}
      </div>
      {open && (
        <NoteDialog
          day={open}
          note={notes[open] ?? ""}
          onClose={() => setOpen(null)}
          onSave={(text) => {
            onNote(open, text);
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}

function NoteDialog({ day, note, onSave, onClose }: { day: string; note: string; onSave: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState(note);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const heading = new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={`Note for ${heading}`} className="w-full rounded-t-3xl bg-[var(--surface)] p-5 shadow-2xl sm:max-w-md sm:rounded-3xl">
        <p className="text-[11px] font-bold tracking-[0.12em] text-amber-600 uppercase">Note</p>
        <h2 className="mt-1 text-[17px] font-semibold text-neutral-900">{heading}</h2>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          rows={5}
          placeholder="Write a note for this day…"
          className="mt-3 w-full resize-none rounded-2xl border border-neutral-300 bg-white px-3.5 py-3 text-[14px] text-neutral-900 focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[12px] text-neutral-500">{note ? "Clear the box and save to remove the note." : "The day gets marked on the calendar."}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-full px-3.5 py-2 text-[13px] font-semibold text-neutral-600 hover:bg-neutral-900/[0.05]">
              Cancel
            </button>
            <button type="button" onClick={() => onSave(text)} disabled={text.trim() === note.trim()} className="rounded-full bg-neutral-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
              Save
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
