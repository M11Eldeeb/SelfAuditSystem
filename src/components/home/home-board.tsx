"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { saveHomeLayout } from "@/app/actions/home-layout";
import { CATEGORY_LABEL, MAX_WIDGETS, STANDARD_LAYOUT, WIDGETS, type HomeLayout, type HomeWidget, type WidgetCategory, type WidgetType } from "@/lib/home/layout";
import type { HomeKpis } from "@/lib/home/kpis";
import type { HomeAction } from "@/lib/home/actions";
import { CalendarWidget, KpisWidget, ReminderWidget, WeatherWidget, useNow } from "@/components/home/widgets-daily";
import { BreatheWidget, CarFactWidget, ClockWidget, CountdownWidget, DiceWidget, FocusWidget, LinksWidget, StickyWidget, TodoWidget, WaterWidget, type WidgetProps } from "@/components/home/widgets-tools";
import { GuessWidget, MemoryWidget, ReactionWidget, ScrambleWidget, TicTacToeWidget } from "@/components/home/widgets-games";

const SIMPLE: Partial<Record<WidgetType, (p: WidgetProps) => ReactNode>> = {
  sticky: StickyWidget,
  todo: TodoWidget,
  focus: FocusWidget,
  clock: ClockWidget,
  links: LinksWidget,
  countdown: CountdownWidget,
  water: WaterWidget,
  tictactoe: TicTacToeWidget,
  memory: MemoryWidget,
  guess: GuessWidget,
  reaction: ReactionWidget,
  scramble: ScrambleWidget,
  breathe: BreatheWidget,
  carfact: CarFactWidget,
  dice: DiceWidget,
};
/** Widgets drawn edge to edge (their own colour fills the card). */
const BLEED = new Set<WidgetType>(["reminder", "sticky"]);

/**
 * The Home page: a welcome, then the person's own widgets. "Add widget" picks from the catalogue (lib/home/layout.ts);
 * "Edit" shows the move and remove buttons. Every change is saved on the account a moment later.
 */
export function HomeBoard({ firstName, initial, kpis, actions }: { firstName: string; initial: HomeLayout | null; kpis: HomeKpis; actions: HomeAction[] }) {
  const [layout, setLayout] = useState<HomeLayout>(initial ?? STANDARD_LAYOUT);
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState(false);
  const [status, setStatus] = useState<"" | "saving" | "saved" | string>("");
  const [, startSave] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(layout);

  const commit = (next: HomeLayout) => {
    setLayout(next);
    latest.current = next;
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      startSave(async () => {
        const r = await saveHomeLayout(latest.current);
        setStatus(r.error ?? "saved");
      });
    }, 700);
  };
  // Leaving the page before the save ran: send it now.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void saveHomeLayout(latest.current);
      }
    },
    []
  );

  const updateWidget = (id: string, patch: Record<string, unknown>) => {
    const cur = latest.current;
    commit({ ...cur, widgets: cur.widgets.map((w) => (w.id === id ? { ...w, data: { ...w.data, ...patch } } : w)) });
  };
  const move = (i: number, by: number) => {
    const list = [...layout.widgets];
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    commit({ ...layout, widgets: list });
  };
  const remove = (id: string) => commit({ ...layout, widgets: layout.widgets.filter((w) => w.id !== id) });
  const add = (type: WidgetType) => {
    let n = 1;
    while (layout.widgets.some((w) => w.id === `${type}-${n}`)) n++;
    const id = "single" in WIDGETS[type] ? type : `${type}-${n}`;
    commit({ ...layout, widgets: [...layout.widgets, { id, type }] });
    setPicker(false);
    requestAnimationFrame(() => document.getElementById(`widget-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  const now = useNow(60_000);
  const hour = now ? Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "numeric", hour12: false }).format(now)) : null;
  const greeting = hour == null ? "Welcome" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const body = (w: HomeWidget) => {
    if (w.type === "reminder") return <ReminderWidget />;
    if (w.type === "weather") return <WeatherWidget />;
    if (w.type === "calendar")
      return (
        <CalendarWidget
          notes={layout.calendar ?? {}}
          onNote={(day, text) => {
            const notes = { ...(layout.calendar ?? {}) };
            if (text.trim()) notes[day] = text.trim();
            else delete notes[day];
            commit({ ...layout, calendar: notes });
          }}
        />
      );
    const C = SIMPLE[w.type];
    return C ? <C data={w.data ?? {}} update={(patch) => updateWidget(w.id, patch)} /> : null;
  };

  const widgetList =
    layout.widgets.length === 0 ? (
      <div className="rounded-[22px] border border-dashed border-neutral-300 p-6 text-center">
        <p className="text-[14px] text-neutral-600">No widgets here.</p>
        <div className="mt-3 flex flex-col items-center gap-2">
          <button type="button" onClick={() => setPicker(true)} className="rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-white">
            Add a widget
          </button>
          <button type="button" onClick={() => commit(STANDARD_LAYOUT)} className="rounded-full px-4 py-2 text-[13px] font-semibold text-neutral-700 ring-1 ring-neutral-900/[0.1]">
            Bring back the standard ones
          </button>
        </div>
      </div>
    ) : (
      <ul className="space-y-4 xl:block xl:columns-2 xl:gap-4 xl:space-y-0">
        {layout.widgets.map((w, i) => {
          const meta = WIDGETS[w.type];
          const bleed = BLEED.has(w.type);
          return (
            <li
              key={w.id}
              id={`widget-${w.id}`}
              className={`home-rise relative flex flex-col xl:mb-4 xl:break-inside-avoid rounded-[22px] bg-[var(--surface)] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_30px_-18px_rgba(0,0,0,0.25)] ring-1 ring-neutral-900/[0.07] ${editing ? "ring-2 ring-brand/30" : ""}`}
              style={{ animationDelay: `${Math.min(i, 10) * 60 + 120}ms` }}
            >
              {!bleed && <h2 className="mb-3 text-[13px] font-semibold tracking-wide text-neutral-500 uppercase">{meta.title}</h2>}
              <div className="flex-1">{body(w)}</div>
              {editing && (
                <div className="absolute top-2.5 right-2.5 z-10 flex gap-1 rounded-full bg-[var(--surface)] p-1 shadow-md ring-1 ring-neutral-900/[0.08]">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${meta.title} up`} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-900/[0.06] disabled:opacity-30">
                    ↑
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === layout.widgets.length - 1} aria-label={`Move ${meta.title} down`} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-900/[0.06] disabled:opacity-30">
                    ↓
                  </button>
                  <button type="button" onClick={() => remove(w.id)} aria-label={`Remove ${meta.title}`} className="flex h-7 w-7 items-center justify-center rounded-full text-red-600 hover:bg-red-50">
                    ×
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );

  return (
    // Wider than the area's page column, like the dashboards: the figures on the left, the widgets in a column on the right.
    // On a wide screen the page itself does not scroll: the figures and the widgets are two columns that scroll apart
    // (their scrollbars show only while in use, globals.css).
    <div className="relative left-1/2 w-[min(88rem,calc(100vw-var(--sidebar-w,0px)-2rem))] -translate-x-1/2 lg:h-[calc(100dvh-8.5rem)]">
      <div className="grid grid-cols-1 items-start gap-5 lg:h-full lg:grid-cols-[minmax(0,1fr)_21rem] lg:grid-rows-[minmax(0,1fr)] lg:items-stretch xl:grid-cols-[minmax(0,1fr)_41rem]">
        <div className="flex min-w-0 flex-col lg:min-h-0">
          <div className="mb-6 lg:mb-4 lg:shrink-0">
            <h1 className="text-[28px] leading-tight font-bold tracking-[-0.01em] text-neutral-900">
              {greeting}
              {firstName ? `, ${firstName}` : ""}
            </h1>
            <p className="mt-1 text-[15px] text-neutral-500">{now ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", weekday: "long", day: "numeric", month: "long" }).format(now) : " "} · Here is your day.</p>
          </div>
          {/* The padding and the matching negative margin keep the cards' shadows and rings from being cut by the scroll area. */}
          <section aria-label={kpis.title} className="min-w-0 space-y-6 lg:-mx-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:px-2 lg:pt-1 lg:pb-6">
            <ActionList actions={actions} />
            <KpisWidget kpis={kpis} />
          </section>
        </div>
        <aside aria-label="My widgets" className="flex min-w-0 flex-col lg:min-h-0">
          <div className="mb-3 flex shrink-0 items-center justify-end gap-2 lg:mb-4 lg:min-h-[3.75rem] lg:items-start">
            <span className="mr-auto text-[12px] text-neutral-500" aria-live="polite">
              {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status}
            </span>
            <button type="button" onClick={() => setEditing((e) => !e)} aria-pressed={editing} className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${editing ? "bg-neutral-900 text-white" : "bg-[var(--surface)] text-neutral-800 ring-1 ring-neutral-900/[0.1] hover:bg-neutral-50"}`}>
              {editing ? "Done" : "Edit"}
            </button>
            <button type="button" onClick={() => setPicker(true)} disabled={layout.widgets.length >= MAX_WIDGETS} className="rounded-full bg-brand px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-brand-dark active:scale-95 disabled:opacity-50">
              + Add widget
            </button>
          </div>
          <div className="lg:-mx-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:px-2 lg:pt-1 lg:pb-6">{widgetList}</div>
        </aside>
      </div>

      {picker && <WidgetPicker present={new Set(layout.widgets.map((w) => w.type))} onPick={add} onClose={() => setPicker(false)} />}
    </div>
  );
}

/** What waits for this person (lib/home/actions.ts): a count and the page where it is done. */
function ActionList({ actions }: { actions: HomeAction[] }) {
  const waiting = actions.filter((a) => a.count > 0).length;
  return (
    <section className="rounded-[22px] bg-[var(--surface)] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-neutral-900/[0.07]">
      <h2 className="text-[15px] font-semibold text-neutral-900">Needs your action</h2>
      {actions.length === 0 || waiting === 0 ? (
        <p className="mt-2 text-[14px] text-neutral-500">Nothing waits for you right now. Well done!</p>
      ) : null}
      {actions.length > 0 && (
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
          {actions.map((a) => (
            <li key={a.key}>
              <Link href={a.href} className={`flex items-center gap-3 rounded-xl bg-neutral-900/[0.035] px-3 py-2.5 transition-colors hover:bg-neutral-900/[0.07] ${a.count > 0 ? "" : "opacity-60 hover:opacity-100"}`}>
                <span className={`flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-[14px] font-bold tabular-nums ${a.count > 0 ? "bg-brand text-white" : "bg-[var(--surface)] text-neutral-500"}`}>{a.count}</span>
                <span className="min-w-0 flex-1 text-[14px] font-medium text-neutral-800">{a.label}</span>
                <span aria-hidden="true" className="text-neutral-400">↗</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WidgetPicker({ present, onPick, onClose }: { present: Set<WidgetType>; onPick: (t: WidgetType) => void; onClose: () => void }) {
  const [tab, setTab] = useState<WidgetCategory | "all">("all");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const list = (Object.keys(WIDGETS) as WidgetType[]).filter((t) => tab === "all" || WIDGETS[t].category === tab);
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Add a widget" className="flex max-h-[85vh] w-full flex-col rounded-t-3xl bg-[var(--surface)] shadow-2xl sm:max-w-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between gap-3 px-5 pt-5">
          <h2 className="text-[18px] font-semibold text-neutral-900">Add a widget</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-900/[0.05]">
            ×
          </button>
        </div>
        <div role="tablist" className="flex flex-wrap gap-1.5 px-5 pt-3">
          {(["all", ...Object.keys(CATEGORY_LABEL)] as (WidgetCategory | "all")[]).map((c) => (
            <button key={c} type="button" role="tab" aria-selected={tab === c} onClick={() => setTab(c)} className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${tab === c ? "bg-neutral-900 text-white" : "bg-neutral-900/[0.05] text-neutral-700 hover:bg-neutral-900/[0.08]"}`}>
              {c === "all" ? "All" : CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
        <ul className="grid flex-1 grid-cols-1 gap-2 overflow-y-auto p-5 sm:grid-cols-2">
          {list.map((t) => {
            const m = WIDGETS[t];
            const taken = "single" in m && m.single && present.has(t);
            return (
              <li key={t}>
                <button type="button" onClick={() => onPick(t)} disabled={taken} className="flex h-full w-full flex-col items-start rounded-2xl bg-neutral-900/[0.035] px-4 py-3 text-left transition hover:bg-neutral-900/[0.07] disabled:cursor-default disabled:opacity-45">
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="text-[15px] font-semibold text-neutral-900">{m.title}</span>
                    <span className="text-[11px] font-semibold text-neutral-500">{taken ? "On your Home" : CATEGORY_LABEL[m.category]}</span>
                  </span>
                  <span className="mt-0.5 text-[13px] text-neutral-600">{m.blurb}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
