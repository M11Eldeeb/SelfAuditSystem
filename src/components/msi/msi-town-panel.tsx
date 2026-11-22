"use client";

import type { ReactNode } from "react";
import type { BusinessBranch } from "@/app/admin/msi/actions";
import type { TownDetails } from "@/lib/msi/town";
import { money, pct, MONTHS } from "@/components/msi/msi-ui";
import { short } from "@/components/msi/msi-overview";

// The details of one department of the 3D service centre, opened by clicking its building or its card.
// Status colours always come with an icon and a word.

export type Dept = "sales" | "workshop" | "customers" | "warranty" | "room" | "audit" | "care";
export const DEPT_TITLE: Record<Dept, { icon: string; title: string; sub: string }> = {
  sales: { icon: "📈", title: "Sales", sub: "Major Service Indicators - this month" },
  workshop: { icon: "🔧", title: "Workshop", sub: "Open job cards, cycle time, promised dates, quality control" },
  customers: { icon: "👥", title: "Customers", sub: "Customer queue and appointments - today" },
  warranty: { icon: "🛡️", title: "Warranty", sub: "Warranty claims of the year, settlement, inquiries" },
  room: { icon: "📦", title: "Warranty room", sub: "Scrap cycle, destroy evidence, part returns, supplier collections" },
  audit: { icon: "📋", title: "Audit", sub: "Self-audit cycle and internal audits" },
  care: { icon: "💬", title: "Complaints", sub: "Customer complaints of the year" },
};

const GOOD = "#248a3d";
const WARN = "#b45309";
const BAD = "#d70015";
const INK = "#3a3a3c";
type Tone = "good" | "warn" | "bad" | undefined;
const TONE: Record<"good" | "warn" | "bad", { c: string; i: string }> = { good: { c: GOOD, i: "✓" }, warn: { c: WARN, i: "!" }, bad: { c: BAD, i: "↓" } };
const n0 = (v: number | null | undefined) => (v == null ? "—" : money(v));
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const toneAtLeast = (v: number | null, good: number, warn: number): Tone => (v == null ? undefined : v >= good ? "good" : v >= warn ? "warn" : "bad");
const toneAtMost = (v: number | null, good: number, warn: number): Tone => (v == null ? undefined : v <= good ? "good" : v <= warn ? "warn" : "bad");
const monthLabel = (iso: string | null) => (iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : "—");

function Tile({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: Tone }) {
  return (
    <div className="rounded-xl bg-[#f5f5f7] px-3 py-2.5">
      <div className="text-[11px] font-semibold tracking-wide text-[#6e6e73] uppercase">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5 text-[20px] font-bold tracking-tight text-[#1d1d1f] tabular-nums">
        {value}
        {tone && (
          <span className="text-[12px] font-bold" style={{ color: TONE[tone].c }}>
            {TONE[tone].i}
          </span>
        )}
      </div>
      {note && <div className="text-[11px] text-[#6e6e73]">{note}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-[13px] font-semibold text-[#1d1d1f]">{title}</h4>
      {children}
    </section>
  );
}

/** Horizontal bars (one hue), largest first, with the count and share. */
function Bars({ items, color = INK }: { items: { label: string; n: number; color?: string }[]; color?: string }) {
  const total = items.reduce((s, i) => s + i.n, 0) || 1;
  const max = Math.max(1, ...items.map((i) => i.n));
  if (!items.length) return <p className="text-xs text-[#6e6e73]">Nothing yet.</p>;
  return (
    <div className="space-y-1.5">
      {items.map((i) => (
        <div key={i.label} title={`${i.label}: ${i.n}`}>
          <div className="flex justify-between gap-2 text-xs">
            <span className="truncate text-[#1d1d1f]">{i.label}</span>
            <span className="shrink-0 text-[#6e6e73] tabular-nums">
              {money(i.n)} · {pct(i.n / total)}
            </span>
          </div>
          <div className="mt-0.5 h-2 rounded-full bg-[#ececf0]">
            <div className="h-full rounded-full" style={{ width: `${(i.n / max) * 100}%`, backgroundColor: i.color ?? color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Small columns (e.g. claims per month), the value on hover and under the last one. */
function Columns({ items, format = (v: number) => money(v) }: { items: { label: string; v: number }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.v));
  if (!items.length) return <p className="text-xs text-[#6e6e73]">Nothing yet.</p>;
  return (
    <div>
      <div className="flex h-24 items-end gap-1">
        {items.map((i) => (
          <div key={i.label} className="group relative flex flex-1 flex-col items-center justify-end" title={`${i.label}: ${format(i.v)}`}>
            <span className="mb-0.5 text-[9px] whitespace-nowrap text-[#6e6e73] tabular-nums group-hover:text-[#1d1d1f]">{short(i.v)}</span>
            <div className="w-full rounded-t-[4px] bg-[#3a3a3c] group-hover:bg-[#1d1d1f]" style={{ height: `${Math.max(2, (i.v / max) * 80)}px` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {items.map((i) => (
          <span key={i.label} className="flex-1 truncate text-center text-[10px] text-[#6e6e73]">
            {i.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A tiny line of the open WIPs day by day. */
function Spark({ points }: { points: { day: string; n: number }[] }) {
  if (points.length < 2) return <p className="text-xs text-[#6e6e73]">Not enough days yet.</p>;
  const W = 300;
  const H = 60;
  const min = Math.min(...points.map((p) => p.n));
  const max = Math.max(...points.map((p) => p.n));
  const y = (v: number) => H - 6 - ((v - min) / Math.max(1, max - min)) * (H - 14);
  const d = points.map((p, i) => `${i ? "L" : "M"}${((i / (points.length - 1)) * W).toFixed(1)},${y(p.n).toFixed(1)}`).join(" ");
  const last = points.at(-1)!;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Open WIPs over the last 30 days">
        <path d={d} fill="none" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
        <circle cx={W} cy={y(last.n)} r={3.5} fill={INK} />
      </svg>
      <div className="flex justify-between text-[10px] text-[#6e6e73]">
        <span>
          {points[0].day.slice(8, 10)}/{points[0].day.slice(5, 7)}: {points[0].n}
        </span>
        <span>
          today: <b className="text-[#1d1d1f]">{last.n}</b>
        </span>
      </div>
    </div>
  );
}

const grid = "grid grid-cols-2 gap-2";

export function DeptPanel({ dept, details, branches, selected, error, onClose }: { dept: Dept; details: TownDetails | null; branches: BusinessBranch[]; selected: BusinessBranch[]; error: string | null; onClose: () => void }) {
  const head = DEPT_TITLE[dept];
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-black/[0.06] px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-[17px] font-bold text-[#1d1d1f]">
            <span aria-hidden="true">{head.icon}</span>
            {head.title}
          </div>
          <div className="text-xs text-[#6e6e73]">{head.sub}</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-[#6e6e73] hover:bg-[#f5f5f7]" aria-label="Close the details">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {dept === "sales" ? (
          <SalesBody branches={branches} selected={selected} />
        ) : !details ? (
          <p className="text-sm text-[#6e6e73]">{error ?? "Loading…"}</p>
        ) : dept === "workshop" ? (
          <WorkshopBody d={details.workshop} />
        ) : dept === "warranty" ? (
          <WarrantyBody d={details.warranty} />
        ) : dept === "room" ? (
          <RoomBody d={details.room} />
        ) : dept === "audit" ? (
          <AuditBody d={details.audit} />
        ) : dept === "customers" ? (
          <CustomersBody d={details.customers} />
        ) : (
          <CareBody d={details.complaints} />
        )}
      </div>
    </div>
  );
}

function SalesBody({ branches, selected }: { branches: BusinessBranch[]; selected: BusinessBranch[] }) {
  const sold = selected.reduce((s, b) => s + (b.sold ?? 0), 0);
  const planned = selected.reduce((s, b) => s + (b.vsPlan ? (b.sold ?? 0) / b.vsPlan : 0), 0);
  const vs = selected.length === 1 ? selected[0].vsPlan : ratio(sold, planned);
  const ranked = branches.filter((b) => b.vsPlan != null).sort((a, b) => (b.vsPlan ?? 0) - (a.vsPlan ?? 0));
  const max = Math.max(1.2, ...ranked.map((b) => Math.min(1.6, b.vsPlan ?? 0)));
  return (
    <>
      <div className={grid}>
        <Tile label="Sold this month" value={`SAR ${short(sold)}`} />
        <Tile label="vs plan for today" value={pct(vs)} tone={toneAtLeast(vs, 1, 0.9)} />
        <Tile label="Plan for today" value={`SAR ${short(planned)}`} />
        <Tile label="Gap" value={`SAR ${short(Math.abs(sold - planned))}`} note={sold >= planned ? "ahead of plan" : "behind plan"} tone={sold >= planned ? "good" : "bad"} />
      </div>
      <Section title="Branches against the plan for today (line = 100%)">
        <div className="space-y-1.5">
          {ranked.map((b) => {
            const t = toneAtLeast(b.vsPlan, 1, 0.9)!;
            const on = selected.length === 1 && selected[0].code === b.code;
            return (
              <div key={b.code} className={`grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-2 text-xs ${on ? "font-bold" : ""}`}>
                <span className="truncate">{b.name}</span>
                <div className="relative h-2.5 rounded-full bg-[#ececf0]">
                  <div className="h-full rounded-full" style={{ width: `${(Math.min(max, b.vsPlan ?? 0) / max) * 100}%`, backgroundColor: TONE[t].c }} />
                  <div className="absolute -inset-y-1 w-0.5 bg-[#1d1d1f]" style={{ left: `${(1 / max) * 100}%` }} />
                </div>
                <span className="text-right tabular-nums" style={{ color: TONE[t].c }}>
                  {TONE[t].i} {pct(b.vsPlan)}
                </span>
              </div>
            );
          })}
        </div>
      </Section>
      <p className="text-xs text-[#6e6e73]">More in the Overview and Branches tabs of this page.</p>
    </>
  );
}

function WorkshopBody({ d }: { d: TownDetails["workshop"] }) {
  const ageLabels = ["0-7 days", "8-15 days", "16-30 days", "31-60 days", "Over 60 days"];
  const ageColors = ["#c7c7cc", "#a1a1a6", "#6e6e73", WARN, BAD];
  const firstTime = ratio(d.qc.firstTime, d.qc.total);
  return (
    <>
      <div className={grid}>
        <Tile label="Open WIPs" value={n0(d.open)} note={`SAR ${short(d.value)} to invoice`} />
        <Tile label="Avg. age (cycle time)" value={d.avgAge == null ? "—" : `${d.avgAge} d`} note="days since received" tone={toneAtMost(d.avgAge, 7, 15)} />
        <Tile label="Past promised date" value={n0(d.overdue)} note={`${pct(ratio(d.overdue, d.open))} of open · SLA`} tone={toneAtMost(ratio(d.overdue, d.open), 0.05, 0.15)} />
        <Tile label="Due today" value={n0(d.dueToday)} />
        <Tile label="Awaiting parts" value={n0(d.awaitingParts)} />
        <Tile label="Done, not invoiced" value={n0(d.completeNotInvoiced)} tone={d.completeNotInvoiced > 0 ? "warn" : "good"} />
      </div>
      <Section title="How old the open job cards are">
        <Bars items={d.ageing.map((n, i) => ({ label: ageLabels[i], n, color: ageColors[i] }))} />
      </Section>
      <Section title="Open WIPs - last 30 days">
        <Spark points={d.trend} />
      </Section>
      <Section title="Where the job cards stand">
        <Bars items={d.statuses.map((s) => ({ label: s.label, n: s.n }))} />
      </Section>
      <Section title="Labour and parts waiting to be invoiced">
        <Bars items={[{ label: "Labour", n: d.labour }, { label: "Parts", n: d.parts }]} />
      </Section>
      <Section title="Quality control (this year)">
        <div className={grid}>
          <Tile label="QC checks" value={n0(d.qc.total)} note={`${d.qc.passed} passed · ${d.qc.failed} failed`} />
          <Tile label="Right first time" value={pct(firstTime)} tone={toneAtLeast(firstTime, 0.9, 0.8)} />
        </div>
      </Section>
      <Section title="Technician claims">
        <div className={grid}>
          <Tile label="Waiting review" value={n0(d.techClaims.waiting)} tone={d.techClaims.waiting > 0 ? "warn" : "good"} />
          <Tile label="Review time" value={d.techClaims.reviewHours == null ? "—" : `${d.techClaims.reviewHours} h`} note="average, last 90 days" tone={toneAtMost(d.techClaims.reviewHours, 24, 48)} />
          <Tile label="Returned to technician" value={n0(d.techClaims.returned)} />
          <Tile label="Approved / rejected" value={`${d.techClaims.approved} / ${d.techClaims.rejected}`} note="this year" />
        </div>
      </Section>
    </>
  );
}

function WarrantyBody({ d }: { d: TownDetails["warranty"] }) {
  const settledShare = ratio(d.settled, d.claims);
  return (
    <>
      <div className={grid}>
        <Tile label="Claims this year" value={n0(d.claims)} note={`SAR ${short(d.amount)}`} />
        <Tile label="Settled" value={pct(settledShare)} note={`${n0(d.settled)} · SAR ${short(d.settledAmount)}`} />
        <Tile label="In progress" value={n0(d.inProgress)} />
        <Tile label="Rejected" value={n0(d.rejected)} note={pct(ratio(d.rejected, d.claims))} tone={toneAtMost(ratio(d.rejected, d.claims), 0.02, 0.05)} />
        <Tile label="Repair to submit" value={d.submitDays == null ? "—" : `${d.submitDays} d`} note="end of repair -> dealer submit" tone={toneAtMost(d.submitDays, 7, 14)} />
        <Tile label="Submit to settle" value={d.settleDays == null ? "—" : `${d.settleDays} d`} note="dealer submit -> settlement" />
        <Tile label="Returned once or more" value={n0(d.returned)} note={pct(ratio(d.returned, d.claims))} tone={toneAtMost(ratio(d.returned, d.claims), 0.05, 0.1)} />
        <Tile label="Prior approval" value={n0(d.priorApproval)} />
      </div>
      <Section title="Claims per month">
        <Columns items={d.months.map((m) => ({ label: MONTHS[Number(m.m.slice(5, 7)) - 1], v: m.n }))} />
      </Section>
      <Section title="Claim status">
        <Bars items={d.statuses.map((s) => ({ label: s.label, n: s.n }))} />
      </Section>
      <Section title="Support">
        <div className={grid}>
          <Tile label="Technical inquiries" value={n0(d.inquiries.total)} note={`${d.inquiries.open} open`} tone={d.inquiries.open > 0 ? "warn" : undefined} />
          <Tile label="First answer" value={d.inquiries.firstResponseHours == null ? "—" : `${d.inquiries.firstResponseHours} h`} note="average" />
          <Tile label="Verification codes" value={n0(d.verifications.total)} note={`${d.verifications.open} open`} />
          <Tile label="Rejected claims register" value={n0(d.rejectedRegister)} note="this year" />
        </div>
      </Section>
    </>
  );
}

function RoomBody({ d }: { d: TownDetails["room"] }) {
  return (
    <>
      <p className="text-xs text-[#6e6e73]">Cycle: {monthLabel(d.cycle)}</p>
      <div className={grid}>
        <Tile label="Parts to scrap" value={n0(d.flaggedParts)} note={`${n0(d.flaggedClaims)} claims flagged`} tone={d.flaggedParts > 0 ? "warn" : "good"} />
        <Tile label="Scrapped this cycle" value={n0(d.scrappedThisCycle)} note={`${n0(d.scrappedYear)} parts this year`} />
        <Tile label="Destroy evidence approved" value={n0(d.evidence.approved)} note="branches this cycle" />
        <Tile label="Evidence waiting approval" value={n0(d.evidence.waiting)} tone={d.evidence.waiting > 0 ? "warn" : "good"} />
        <Tile label="Part returns open" value={n0(d.returnsOpen)} note={`${n0(d.returnsClosed)} closed this year`} tone={d.returnsOpen > 0 ? "warn" : "good"} />
        <Tile label="Supplier collections open" value={n0(d.collectionsOpen)} note={`${n0(d.collectionsDone)} handed over this year`} />
      </div>
    </>
  );
}

function AuditBody({ d }: { d: TownDetails["audit"] }) {
  const done = ratio(d.done, d.assignments);
  return (
    <>
      <p className="text-xs text-[#6e6e73]">
        Self-audit cycle: {monthLabel(d.cycle)} · {d.cycleStatus ?? "—"}
        {d.deadline ? ` · deadline ${new Date(d.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Riyadh" })}` : ""}
      </p>
      <div className={grid}>
        <Tile label="Claims audited" value={`${d.done} / ${d.assignments}`} note={`${pct(done)} done · ${d.reviewed} reviewed`} tone={toneAtLeast(done, 1, 0.7)} />
        <Tile label="Self-audit score" value={d.score == null ? "—" : `${d.score}%`} tone={toneAtLeast(d.score, 90, 80)} />
        <Tile label="Branch operations" value={n0(d.opsSubmitted)} note="checklists submitted" />
        <Tile label="Internal audits" value={n0(d.internal.count)} note={`this year · avg ${d.internal.score ?? "—"}%`} tone={toneAtLeast(d.internal.score, 90, 80)} />
      </div>
      <Section title="Self-audit score by cycle">
        <Columns items={d.scores.map((s) => ({ label: MONTHS[Number(s.m.slice(5, 7)) - 1], v: s.score }))} format={(v) => `${v}%`} />
      </Section>
      {d.internal.last && <p className="text-xs text-[#6e6e73]">Last internal audit: {new Date(d.internal.last).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>}
    </>
  );
}

function CustomersBody({ d }: { d: TownDetails["customers"] }) {
  return (
    <>
      <div className={grid}>
        <Tile label="Customers today" value={n0(d.today)} />
        <Tile label="Waiting now" value={n0(d.waiting)} tone={toneAtMost(d.waiting, 3, 8)} />
        <Tile label="Served" value={n0(d.served)} />
        <Tile label="Average wait" value={d.avgWait == null ? "—" : `${d.avgWait} min`} tone={toneAtMost(d.avgWait, 10, 20)} />
        <Tile label="Appointments today" value={n0(d.appointments)} />
        <Tile label="No-shows" value={n0(d.noShow)} />
      </div>
      {d.today === 0 && <p className="text-xs text-[#6e6e73]">No customer took a ticket today yet - the queue starts counting when the branches use it.</p>}
    </>
  );
}

function CareBody({ d }: { d: TownDetails["complaints"] }) {
  const validShare = ratio(d.valid, d.valid + d.notValid);
  return (
    <>
      <div className={grid}>
        <Tile label="Complaints this year" value={n0(d.total)} />
        <Tile label="Still open" value={n0(d.open)} tone={d.open > 0 ? "bad" : "good"} />
        <Tile label="Valid" value={pct(validShare)} note={`${d.valid} valid · ${d.notValid} not valid`} tone={toneAtMost(validShare, 0.1, 0.2)} />
        <Tile label="Time to resolve" value={d.resolveDays == null ? "—" : `${d.resolveDays} d`} note="average" tone={toneAtMost(d.resolveDays, 3, 7)} />
      </div>
      <Section title="Top categories">
        <Bars items={d.categories.map((c) => ({ label: c.label, n: c.n }))} />
      </Section>
      <Section title="Where they came from">
        <Bars items={d.sources.map((c) => ({ label: c.label, n: c.n }))} />
      </Section>
    </>
  );
}
