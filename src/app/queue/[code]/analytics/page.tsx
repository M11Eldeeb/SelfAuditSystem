import { appointmentsSince, queuePage, ticketsSince } from "@/lib/queue/pages";
import { BranchTabs } from "@/components/queue/branch-tabs";
import { AnalyticsView, daysParam } from "@/components/queue/analytics-view";

export default async function QueueAnalyticsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ days?: string }> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const { a, branch } = await queuePage(code);
  const days = daysParam(sp.days);
  const [rows, appts] = await Promise.all([ticketsSince(days, branch.id), appointmentsSince(days, branch.id)]);
  const mine = a.role === "parts_advisor" ? rows.filter((r) => r.service_mode === "spare_parts") : a.role === "advisor" ? rows.filter((r) => r.service_mode !== "spare_parts") : rows;
  return (
    <>
      <BranchTabs code={branch.queue_code} name={branch.name} active="analytics" manager={a.role === "manager"} role={a.role} />
      <AnalyticsView rows={mine} days={days} basePath={`/queue/${branch.queue_code}/analytics`} appts={a.role === "parts_advisor" ? undefined : appts} />
    </>
  );
}
