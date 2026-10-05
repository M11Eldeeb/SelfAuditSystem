import type { ReactNode } from "react";

// --- formatting -------------------------------------------------------------

export function fmtInt(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function fmtNum(v: number | null, digits = 1): string {
  return v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtMoney(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function fmtCompact(v: number): string {
  return v.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
}

export function fmtDays(v: number | null): string {
  return v == null ? "—" : v.toFixed(1);
}

export function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10).replace(/\//g, "-")}T00:00:00Z`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

// --- building blocks --------------------------------------------------------

export const card = "rounded-xl bg-white shadow-[0_1px_2px_0_rgba(17,24,39,0.05)] ring-1 ring-[#dce9ff]/60";

export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`text-[11px] font-bold tracking-[0.08em] text-[#575e70] uppercase ${className}`}>{children}</span>;
}

export function Card({ children, className = "", accent }: { children: ReactNode; className?: string; accent?: string }) {
  return (
    <div className={`${card} relative overflow-hidden p-4 ${className}`}>
      {accent && <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: accent }} />}
      {children}
    </div>
  );
}

export function Panel({
  eyebrow,
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${card} p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <Label className="text-[#9a000d]">{eyebrow}</Label>}
          <h2 className="font-display text-lg font-semibold tracking-tight text-[#0b1c30]">{title}</h2>
          {subtitle && <p className="text-xs text-[#575e70]">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Metric({ value, unit, tone }: { value: string; unit?: string; tone?: "red" | "blue" | "green" }) {
  const color = tone === "red" ? "text-[#9a000d]" : tone === "blue" ? "text-[#0041b0]" : tone === "green" ? "text-emerald-600" : "text-[#0b1c30]";
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`font-display text-[1.75rem] leading-tight font-bold tracking-tight tabular-nums ${color}`}>{value}</span>
      {unit && <span className="text-xs font-semibold text-[#575e70]">{unit}</span>}
    </div>
  );
}

export function Pill({ tone, children }: { tone: "good" | "warn" | "bad" | "muted" | "blue"; children: ReactNode }) {
  const cls = {
    good: "bg-emerald-50 text-emerald-700",
    warn: "bg-amber-50 text-amber-700",
    bad: "bg-[#ffdad6] text-[#93000a]",
    muted: "bg-[#eff4ff] text-[#575e70]",
    blue: "bg-[#dbe1ff] text-[#00174b]",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${cls}`}>{children}</span>;
}

export function IconBadge({ children, tone = "red" }: { children: ReactNode; tone?: "red" | "blue" | "slate" }) {
  const cls = tone === "red" ? "text-[#9a000d]" : tone === "blue" ? "text-[#0041b0]" : "text-[#575e70]";
  return <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#eff4ff] ${cls}`}>{children}</span>;
}

// --- icons (inline, stroke-based) ---------------------------------------------

function Svg({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const Icon = {
  gauge: (p: { size?: number }) => (
    <Svg {...p}>
      <path d="M12 14l4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </Svg>
  ),
  timer: (p: { size?: number }) => (
    <Svg {...p}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2 2M9 2h6" />
    </Svg>
  ),
  receipt: (p: { size?: number }) => (
    <Svg {...p}>
      <path d="M4 2v20l3-2 3 2 3-2 3 2 3-2V2l-3 2-3-2-3 2-3-2z" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </Svg>
  ),
  box: (p: { size?: number }) => (
    <Svg {...p}>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </Svg>
  ),
  check: (p: { size?: number }) => (
    <Svg {...p}>
      <path d="M9 11l3 3 8-8" />
      <path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </Svg>
  ),
  alert: (p: { size?: number }) => (
    <Svg {...p}>
      <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </Svg>
  ),
  car: (p: { size?: number }) => (
    <Svg {...p}>
      <path d="M5 17h14v-5l-2-5H7l-2 5z" />
      <circle cx="7.5" cy="17.5" r="1.5" />
      <circle cx="16.5" cy="17.5" r="1.5" />
    </Svg>
  ),
  wrench: (p: { size?: number }) => (
    <Svg {...p}>
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />
    </Svg>
  ),
  upload: (p: { size?: number }) => (
    <Svg {...p}>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 20h16" />
    </Svg>
  ),
  money: (p: { size?: number }) => (
    <Svg {...p}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
    </Svg>
  ),
  calendar: (p: { size?: number }) => (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </Svg>
  ),
  trash: (p: { size?: number }) => (
    <Svg {...p}>
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    </Svg>
  ),
};
