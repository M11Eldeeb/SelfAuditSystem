import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { REQUEST_STATUS_LABELS, REQUEST_STATUS_TONE, requestLabel, type PartReturn } from "@/lib/part-returns";
import { DeductionButtons } from "./deduction-buttons";

const TABS: { id: PartReturn["status"] | "all"; label: string }[] = [
  { id: "open", label: "Waiting for branch" },
  { id: "dispatched", label: "Dispatched to warranty team" },
  { id: "closed", label: "Sent to manufacturer" },
  { id: "all", label: "All" },
];

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Riyadh" }) : "—";
}

export default async function AdminPartReturnsPage({ searchParams }: { searchParams: Promise<{ status?: string; deductions?: string }> }) {
  await requireRole("officer");
  const params = await searchParams;
  const status = (TABS.find((t) => t.id === params.status)?.id ?? "open") as (typeof TABS)[number]["id"];
  const showDeducted = params.deductions === "all";
  const supabase = await createClient();

  let reqQuery = supabase.from("self_audit_part_returns").select("*").order("created_at", { ascending: false }).limit(200);
  if (status !== "all") reqQuery = reqQuery.eq("status", status);

  const [{ data: requests }, { data: branches }, { data: counts }, { data: deductions }] = await Promise.all([
    reqQuery,
    supabase.from("self_audit_branches").select("id, name"),
    supabase.from("self_audit_part_returns").select("status"),
    supabase
      .from("self_audit_part_return_items")
      .select("id, request_id, claim_number, work_order_no, part_no, part_name, quantity, claim_amount, missing_reason, deduction_status, deducted_at")
      .in("deduction_status", showDeducted ? ["pending", "deducted"] : ["pending"])
      .order("created_at", { ascending: false }),
  ]);

  const requestIds = (requests ?? []).map((r) => r.id);
  const { data: items } = requestIds.length
    ? await supabase.from("self_audit_part_return_items").select("request_id, claim_number, status").in("request_id", requestIds)
    : { data: [] as { request_id: string; claim_number: string; status: string }[] };

  // Requests for the deduction tracker rows (for branch + request number).
  const trackerReqIds = [...new Set((deductions ?? []).map((d) => d.request_id))];
  const { data: trackerReqs } = trackerReqIds.length
    ? await supabase.from("self_audit_part_returns").select("id, request_no, branch_id").in("id", trackerReqIds)
    : { data: [] as { id: string; request_no: number; branch_id: string }[] };
  const trackerReq = new Map((trackerReqs ?? []).map((r) => [r.id, r]));

  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const countBy = (s: string) => (counts ?? []).filter((c) => c.status === s).length;
  const pendingDeduction = (deductions ?? []).filter((d) => d.deduction_status === "pending");
  const pendingAmount = pendingDeduction.reduce((s, d) => s + (Number(d.claim_amount) || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Part Return</h1>
          <p className="text-sm text-neutral-600">Parts the manufacturer asked back: request from branches, track dispatch and forward to the manufacturer.</p>
        </div>
        <Link
          href="/admin/part-returns/new"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark"
        >
          + New request
        </Link>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-neutral-200/70">
        {TABS.map((t) => {
          const n = t.id === "all" ? (counts ?? []).length : countBy(t.id);
          const active = t.id === status;
          return (
            <Link
              key={t.id}
              href={`/admin/part-returns?status=${t.id}`}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${active ? "bg-brand text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
            >
              {t.label} <span className={active ? "text-white/80" : "text-neutral-400"}>({n})</span>
            </Link>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200/70 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            <tr>
              <th className="px-4 py-2">Request</th>
              <th className="px-4 py-2">Branch</th>
              <th className="px-4 py-2">Claims / parts</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Requested</th>
              <th className="px-4 py-2">Branch waybill</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {(requests ?? []).map((r) => {
              const its = (items ?? []).filter((i) => i.request_id === r.id);
              const missing = its.filter((i) => i.status === "missing").length;
              return (
                <tr key={r.id} className="hover:bg-neutral-50">
                  <td className="px-4 py-2.5 font-semibold text-neutral-900">{requestLabel(r.request_no)}</td>
                  <td className="px-4 py-2.5">{branchName.get(r.branch_id)}</td>
                  <td className="px-4 py-2.5 text-neutral-600">
                    {new Set(its.map((i) => i.claim_number)).size} claims · {its.length} parts
                    {missing > 0 && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">{missing} missing</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${REQUEST_STATUS_TONE[r.status]}`}>
                      {REQUEST_STATUS_LABELS[r.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-neutral-600">{fmtDate(r.created_at)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{r.branch_waybill ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/admin/part-returns/${r.id}`} className="text-sm font-medium text-brand hover:underline">
                      {r.status === "dispatched" ? "Receive & close" : "Open"}
                    </Link>
                  </td>
                </tr>
              );
            })}
            {(requests ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-neutral-500">
                  No requests here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">Claims subject to deduction</h2>
            <p className="text-sm text-neutral-600">
              Parts the branch reported missing. {pendingDeduction.length} pending ·{" "}
              {pendingAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} claim amount
            </p>
          </div>
          <Link
            href={`/admin/part-returns?status=${status}${showDeducted ? "" : "&deductions=all"}`}
            className="text-sm text-neutral-500 hover:text-neutral-800"
          >
            {showDeducted ? "Hide deducted" : "Show deducted too"}
          </Link>
        </div>
        <div className="overflow-x-auto rounded-xl border border-neutral-200/70 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              <tr>
                <th className="px-4 py-2">Claim</th>
                <th className="px-4 py-2">Part</th>
                <th className="px-4 py-2">Branch / request</th>
                <th className="px-4 py-2">Justification</th>
                <th className="px-4 py-2 text-right">Claim amount</th>
                <th className="px-4 py-2">Deduction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {(deductions ?? []).map((d) => {
                const req = trackerReq.get(d.request_id);
                return (
                  <tr key={d.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-neutral-900">{d.claim_number}</div>
                      <div className="text-xs text-neutral-500">{d.work_order_no}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div>{d.part_name ?? "—"}</div>
                      <div className="font-mono text-xs text-neutral-500">{d.part_no}</div>
                    </td>
                    <td className="px-4 py-2.5 text-neutral-600">
                      {req && (
                        <>
                          {branchName.get(req.branch_id)} ·{" "}
                          <Link href={`/admin/part-returns/${d.request_id}`} className="text-brand hover:underline">
                            {requestLabel(req.request_no)}
                          </Link>
                        </>
                      )}
                    </td>
                    <td className="max-w-72 px-4 py-2.5 text-xs text-neutral-700">{d.missing_reason}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">
                      {(Number(d.claim_amount) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-2.5">
                      <DeductionButtons itemId={d.id} status={d.deduction_status} deductedAt={d.deducted_at} />
                    </td>
                  </tr>
                );
              })}
              {(deductions ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-neutral-500">
                    Nothing to deduct.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
