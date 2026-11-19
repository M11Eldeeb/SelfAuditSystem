// The Home page's widgets: what can be added, and the shape kept on the account (self_audit_users.home_layout).
// Pure (no imports), so the browser, the server action and a plain Node test can all use it.

export type WidgetCategory = "standard" | "productive" | "games" | "fun";

export const WIDGETS = {
  kpis: { title: "My numbers", blurb: "The figures of your own work, at a glance.", category: "standard", wide: true, single: true },
  reminder: { title: "Today's reminder", blurb: "A kind word for the day.", category: "standard", single: true },
  weather: { title: "Weather", blurb: "Jeddah now and the next three days.", category: "standard", single: true },
  calendar: { title: "Calendar", blurb: "The month, the Hijri date and your notes on any day.", category: "standard", single: true },
  sticky: { title: "Sticky note", blurb: "A coloured note - add as many as you like.", category: "productive" },
  todo: { title: "To-do list", blurb: "Tick things off as you go.", category: "productive" },
  focus: { title: "Focus timer", blurb: "25 minutes of focus, 5 minutes of rest.", category: "productive", single: true },
  clock: { title: "Clock", blurb: "Saudi time and the date, Gregorian and Hijri.", category: "productive", single: true },
  links: { title: "Quick links", blurb: "Your own shortcuts to any page or website.", category: "productive" },
  countdown: { title: "Weekend countdown", blurb: "How long until Thursday afternoon.", category: "productive", single: true },
  water: { title: "Water tracker", blurb: "Eight glasses a day - tap one when you drink.", category: "productive", single: true },
  tictactoe: { title: "Tic-tac-toe", blurb: "Play X against the computer.", category: "games", single: true },
  memory: { title: "Memory match", blurb: "Find the pairs in as few moves as you can.", category: "games", single: true },
  guess: { title: "Guess the number", blurb: "A number from 1 to 100 - higher or lower?", category: "games", single: true },
  reaction: { title: "Reaction test", blurb: "Click the moment it turns green.", category: "games", single: true },
  scramble: { title: "Word scramble", blurb: "Unmix the workshop word.", category: "games", single: true },
  breathe: { title: "Breathe", blurb: "One calm minute: breathe in, hold, breathe out.", category: "fun", single: true },
  carfact: { title: "Car fact of the day", blurb: "Something new about cars, every day.", category: "fun", single: true },
  dice: { title: "Dice & coin", blurb: "Let chance decide who buys the tea.", category: "fun", single: true },
} as const satisfies Record<string, { title: string; blurb: string; category: WidgetCategory; wide?: boolean; single?: boolean }>;

export type WidgetType = keyof typeof WIDGETS;

export const CATEGORY_LABEL: Record<WidgetCategory, string> = { standard: "Standard", productive: "Productive", games: "Games", fun: "Fun" };

/** One widget on the page. `data`: what that widget keeps (a note's text, the to-do items, a best score ...). */
export type HomeWidget = { id: string; type: WidgetType; data?: Record<string, unknown> };

export type HomeLayout = {
  widgets: HomeWidget[];
  /** Calendar notes: "YYYY-MM-DD" -> text. */
  calendar?: Record<string, string>;
};

export const STANDARD_LAYOUT: HomeLayout = {
  widgets: [
    { id: "kpis", type: "kpis" },
    { id: "reminder", type: "reminder" },
    { id: "weather", type: "weather" },
    { id: "calendar", type: "calendar" },
  ],
};

export const MAX_WIDGETS = 40;
/** The whole layout as JSON, at most (keeps a runaway note from bloating the users table). */
export const MAX_LAYOUT_CHARS = 60_000;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A layout from the browser, checked: known widget types only, unique ids, size limits. null when it is not usable. */
export function cleanHomeLayout(input: unknown): HomeLayout | null {
  if (!isObject(input) || !Array.isArray(input.widgets)) return null;
  const seen = new Set<string>();
  const widgets: HomeWidget[] = [];
  for (const w of input.widgets.slice(0, MAX_WIDGETS)) {
    if (!isObject(w) || typeof w.id !== "string" || !w.id || w.id.length > 40 || seen.has(w.id)) continue;
    if (typeof w.type !== "string" || !(w.type in WIDGETS)) continue;
    seen.add(w.id);
    widgets.push({ id: w.id, type: w.type as WidgetType, ...(isObject(w.data) ? { data: w.data } : {}) });
  }
  const calendar: Record<string, string> = {};
  if (isObject(input.calendar)) {
    for (const [day, note] of Object.entries(input.calendar)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && typeof note === "string" && note.trim()) calendar[day] = note.slice(0, 2000);
    }
  }
  const out: HomeLayout = { widgets, ...(Object.keys(calendar).length ? { calendar } : {}) };
  return JSON.stringify(out).length <= MAX_LAYOUT_CHARS ? out : null;
}

/** Riyadh's date as "YYYY-MM-DD". */
export function riyadhDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The same pick for the whole day (moves on at midnight Saudi time). */
export function pickOfTheDay<T>(list: readonly T[], now = new Date()): T {
  const [y, m, d] = riyadhDay(now).split("-").map(Number);
  return list[Math.floor(Date.UTC(y, m - 1, d) / 86_400_000) % list.length];
}

/** The Home page of the area a path belongs to ("/admin/msi" -> "/admin/home"), or null where there is none. */
export const HOME_AREAS = ["admin", "audit", "advisor", "analyst", "technical", "technician", "reviewer", "qc", "queue", "workshop"] as const;
export function homeHrefFor(pathname: string): string | null {
  const area = pathname.split("/")[1];
  return (HOME_AREAS as readonly string[]).includes(area) ? `/${area}/home` : null;
}
