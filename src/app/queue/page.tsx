import Link from "next/link";
import { redirect } from "next/navigation";
import { branchReceiving, requireQueueAccess, queueBranches } from "@/lib/queue/server";
import { receivingText } from "@/lib/queue/hours";
import { appointmentsSince, ticketsSince } from "@/lib/queue/pages";
import { busyLevel, minutesSince, startOfSaudiDay } from "@/lib/queue/core";
import { AnalyticsView, daysParam } from "@/components/queue/analytics-view";

const BUSY = { busy: "bg-red-500", moderate: "bg-amber-400", quiet: "bg-emerald-500" } as const;

/** Head office: every branch's queue today (waiting, with advisors, served, average wait), then the analytics of all branches. Branch people go to their desk. */
export default async function QueueOverviewPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const a = await requireQueueAccess();
  const branches = await queueBranches();
  if (!a.allBranches) {
    const mine = branches.find((b) => b.id === a.branchId);
    if (!mine) return <p className="text-sm text-neutral-600">Your branch has no queue yet - ask the warranty team.</p>;
    redirect(a.role === "parts_advisor" ? `/queue/${mine.queue_code}/parts` : `/queue/${mine.queue_code}`);
  }
  const days = daysParam((await searchParams).days);
  const [rows, appts] = await Promise.all([ticketsSince(days), appointmentsSince(days)]);
  const today = startOfSaudiDay();
  // Each branch's receiving now (working hours + the reception manager's switch).
  const receivingOf = new Map(await Promise.all(branches.map(async (b) => [b.id, (await branchReceiving(b.id)).receiving] as const)));
  const stats = branches.map((b) => {
    const t = rows.filter((r) => r.branch_id === b.id && r.queue_entry_at >= today);
    const served = t.filter((r) => r.served_at);
    const waiting = t.filter((r) => r.status === "waiting");
    return {
      ...b,
      waiting: waiting.length,
      longest: waiting.length ? Math.max(...waiting.map((r) => minutesSince(r.queue_entry_at))) : 0,
      withAdvisor: t.filter((r) => r.status === "called" || r.status === "in_service").length,
      completed: t.filter((r) => r.status === "completed").length,
      avgWait: served.length ? Math.round(served.reduce((s, r) => s + (+new Date(r.served_at!) - +new Date(r.queue_entry_at)), 0) / served.length / 60000) : null,
      receiving: receivingOf.get(b.id)!,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Customer queue</h1>
        <p className="text-sm text-neutral-500">Every branch today. Open a branch for its desks, settings and TV.</p>
      </div>
      {branches.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-sm text-neutral-600 shadow-sm ring-1 ring-neutral-200/70">No branch has a queue code yet - set them in Queue admin.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {stats.map((b) => (
            <div key={b.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
              <div className="flex items-center justify-between gap-2">
                <Link href={`/queue/${b.queue_code}`} className="font-semibold text-neutral-900 hover:text-brand">
                  {b.name}
                </Link>
                <span className="flex items-center gap-1.5 text-xs text-neutral-500">
                  <span className={`h-2 w-2 rounded-full ${BUSY[busyLevel(b.waiting)]}`} />
                  {b.queue_status === "open" ? busyLevel(b.waiting) : b.queue_status}
                </span>
              </div>
              <Link
                href={`/queue/${b.queue_code}/settings`}
                className={`mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium ${b.receiving.open ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
                title="Working hours and receiving - change in Settings"
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${b.receiving.open ? "bg-emerald-500" : "bg-red-500"}`} />
                <span className="truncate">{receivingText(b.receiving, "en")}</span>
              </Link>
              <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                {[
                  ["Waiting", b.waiting],
                  ["With advisor", b.withAdvisor],
                  ["Completed", b.completed],
                  ["Avg wait", b.avgWait == null ? "—" : `${b.avgWait}m`],
                ].map(([l, v]) => (
                  <div key={l as string} className="rounded-lg bg-neutral-50 py-2">
                    <div className="text-lg font-bold text-neutral-900 tabular-nums">{v}</div>
                    <div className="text-[10px] text-neutral-500">{l}</div>
                  </div>
                ))}
              </div>
              {b.waiting > 0 && <p className="mt-2 text-xs text-neutral-500">Longest wait now: {b.longest} min</p>}
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium">
                <Link href={`/queue/${b.queue_code}`} className="text-brand hover:underline">
                  Service desk
                </Link>
                <Link href={`/queue/${b.queue_code}/parts`} className="text-brand hover:underline">
                  Spare parts
                </Link>
                <Link href={`/queue/${b.queue_code}/settings`} className="text-brand hover:underline">
                  Working hours & settings
                </Link>
                <a href={`/q/display/${b.queue_code}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                  TV ↗
                </a>
                <a href={`/q/${b.queue_code}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                  Join page ↗
                </a>
                <a href={`/api/queue/poster/${b.queue_code}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                  Reception poster ↗
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-neutral-900">All branches</h2>
        <AnalyticsView rows={rows} days={days} basePath="/queue" appts={appts} branchNames={Object.fromEntries(branches.map((b) => [b.id, b.name]))} />
      </div>
    </div>
  );
}
