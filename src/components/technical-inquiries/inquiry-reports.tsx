import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SYSTEM_LABEL, basePathFor, durationText, isLate, type InquiryRole, type InquiryStatus, type InquirySystem } from "@/lib/technical-inquiries";

export type ReportParams = { range?: string };

const RANGES: { key: string; label: string; days: number | null }[] = [
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "365", label: "Last 12 months", days: 365 },
  { key: "all", label: "All time", days: null },
];

type Row = {
  branch_id: string;
  system: string;
  status: string;
  priority: string;
  created_at: string;
  first_response_at: string | null;
  closed_at: string | null;
  assigned_to_name: string | null;
  waiting_since: string | null;
};

const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

/** Counts and average times for the technical team and officers: per branch, per vehicle system and per technician. */
export async function InquiryReports({ role, params }: { role: InquiryRole; params: ReportParams }) {
  const supabase = await createClient();
  const basePath = basePathFor(role);
  const range = RANGES.find((r) => r.key === params.range) ?? RANGES[1];
  const since = range.days ? new Date(Date.now() - range.days * 86_400_000).toISOString() : null;

  const [{ data: branches }, { data: all }] = await Promise.all([
    supabase.from("self_audit_branches").select("id, name").order("name"),
    // A few hundred cases a year at most - read once and add up here (the database only returns what the caller may see).
    (since
      ? supabase.from("self_audit_technical_inquiries").select("branch_id, system, status, priority, created_at, first_response_at, closed_at, assigned_to_name, waiting_since").gte("created_at", since)
      : supabase.from("self_audit_technical_inquiries").select("branch_id, system, status, priority, created_at, first_response_at, closed_at, assigned_to_name, waiting_since")
    ).order("created_at", { ascending: false }).limit(5000),
  ]);
  const rows = (all ?? []) as Row[];
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));

  const firstAnswer = (r: Row) => (r.first_response_at ? new Date(r.first_response_at).getTime() - new Date(r.created_at).getTime() : null);
  const toClose = (r: Row) => (r.closed_at ? new Date(r.closed_at).getTime() - new Date(r.created_at).getTime() : null);
  const nums = (list: (number | null)[]) => list.filter((n): n is number => n != null);

  const group = (keyOf: (r: Row) => string) => {
    const map = new Map<string, Row[]>();
    for (const r of rows) map.set(keyOf(r), [...(map.get(keyOf(r)) ?? []), r]);
    return [...map.entries()]
      .map(([key, list]) => ({
        key,
        total: list.length,
        open: list.filter((r) => r.status === "open" || r.status === "awaiting_workshop").length,
        closed: list.filter((r) => r.status === "closed").length,
        cancelled: list.filter((r) => r.status === "cancelled").length,
        avgFirst: average(nums(list.map(firstAnswer))),
        avgClose: average(nums(list.map(toClose))),
      }))
      .sort((a, b) => b.total - a.total);
  };
  const byBranch = group((r) => branchName.get(r.branch_id) ?? "Branch");
  const bySystem = group((r) => SYSTEM_LABEL[r.system as InquirySystem] ?? r.system);
  const byTechnician = group((r) => r.assigned_to_name ?? "Not assigned");

  const lateCount = rows.filter((r) => isLate(r.waiting_since, r.status as InquiryStatus)).length;
  const kpis: { label: string; value: string; tone?: "bad" }[] = [
    { label: "Cases", value: String(rows.length) },
    { label: "Still open", value: String(rows.filter((r) => r.status === "open" || r.status === "awaiting_workshop").length) },
    { label: "Closed", value: String(rows.filter((r) => r.status === "closed").length) },
    { label: "Average first answer", value: durationText(average(nums(rows.map(firstAnswer)))) },
    { label: "Average time to close", value: durationText(average(nums(rows.map(toClose)))) },
    { label: "Waiting more than 2 days", value: String(lateCount), tone: lateCount > 0 ? "bad" : undefined },
  ];

  const table = (title: string, firstColumn: string, data: ReturnType<typeof group>) => (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-neutral-700">{title}</h2>
      <div className="overflow-x-auto rounded-xl border border-neutral-200/70 bg-white shadow-sm">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="border-b border-neutral-100 text-xs text-neutral-500">
            <tr>
              <th className="px-4 py-2 font-medium">{firstColumn}</th>
              <th className="px-3 py-2 text-right font-medium">Cases</th>
              <th className="px-3 py-2 text-right font-medium">Open</th>
              <th className="px-3 py-2 text-right font-medium">Closed</th>
              <th className="px-3 py-2 text-right font-medium">Cancelled</th>
              <th className="px-3 py-2 text-right font-medium">First answer</th>
              <th className="px-4 py-2 text-right font-medium">Time to close</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {data.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-4 text-center text-neutral-500">
                  No cases in this period.
                </td>
              </tr>
            ) : (
              data.map((d) => (
                <tr key={d.key}>
                  <td className="px-4 py-2 font-medium text-neutral-900">{d.key}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.total}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.open}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.closed}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-500">{d.cancelled}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{durationText(d.avgFirst)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{durationText(d.avgClose)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href={basePath} className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to the inquiries
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">Technical Inquiries - reports</h1>
        <p className="text-sm text-neutral-600">How many cases each branch, system and technician has, and how fast they are answered and closed.</p>
      </div>

      <nav aria-label="Period" className="flex flex-wrap gap-1.5">
        {RANGES.map((r) => (
          <Link
            key={r.key}
            href={`${basePath}/reports?range=${r.key}`}
            aria-current={r.key === range.key ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset transition-colors ${r.key === range.key ? "bg-brand text-white ring-brand" : "bg-white text-neutral-700 ring-neutral-200 hover:bg-neutral-50"}`}
          >
            {r.label}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-neutral-500">{k.label}</p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${k.tone === "bad" ? "text-red-600" : "text-neutral-900"}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {table("By branch", "Branch", byBranch)}
      {table("By vehicle system", "System", bySystem)}
      {table("By technician", "Technician", byTechnician)}
    </div>
  );
}
