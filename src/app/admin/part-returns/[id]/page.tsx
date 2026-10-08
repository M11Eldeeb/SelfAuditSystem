import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { REQUEST_STATUS_LABELS, REQUEST_STATUS_TONE, requestLabel } from "@/lib/part-returns";
import { ItemsTable } from "@/components/part-returns/items-table";
import { DeductionButtons } from "../deduction-buttons";
import { OfficerRequestActions } from "./officer-request-actions";

function fmt(iso: string | null) {
  return iso
    ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" })
    : "—";
}

export default async function AdminPartReturnPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("officer");
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: request }, { data: items }] = await Promise.all([
    supabase.from("self_audit_part_returns").select("*").eq("id", id).maybeSingle(),
    supabase.from("self_audit_part_return_items").select("*").eq("request_id", id).order("claim_number").order("part_no"),
  ]);
  if (!request) notFound();
  const { data: branch } = await supabase.from("self_audit_branches").select("name").eq("id", request.branch_id).maybeSingle();

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/admin/part-returns?status=${request.status}`} className="text-sm text-neutral-500 hover:text-neutral-800">
          ← Part Return
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{requestLabel(request.request_no)}</h1>
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${REQUEST_STATUS_TONE[request.status]}`}>
            {REQUEST_STATUS_LABELS[request.status]}
          </span>
        </div>
        <p className="text-sm text-neutral-600">
          {branch?.name} · requested {fmt(request.created_at)}
          {request.officer_note && <> · “{request.officer_note}”</>}
        </p>
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-neutral-500 uppercase">Branch dispatch</div>
          <div className="mt-1 font-mono">{request.branch_waybill ?? "—"}</div>
          <div className="text-xs text-neutral-500">{request.branch_closed_at ? `Closed ${fmt(request.branch_closed_at)}` : "Waiting for branch"}</div>
        </div>
        <div className="rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm sm:col-span-2">
          <div className="text-xs font-semibold text-neutral-500 uppercase">To manufacturer</div>
          {request.status === "closed" ? (
            <div className="mt-1 grid grid-cols-3 gap-2">
              <div>
                <div className="text-xs text-neutral-500">Invoice no.</div>
                <div className="font-mono">{request.invoice_no}</div>
              </div>
              <div>
                <div className="text-xs text-neutral-500">Shipping company</div>
                <div>{request.shipping_company}</div>
              </div>
              <div>
                <div className="text-xs text-neutral-500">Waybill</div>
                <div className="font-mono">{request.oem_waybill}</div>
              </div>
            </div>
          ) : (
            <div className="mt-1 text-neutral-500">Not sent yet</div>
          )}
        </div>
      </div>

      <ItemsTable
        items={items ?? []}
        renderAction={(i) => (i.status === "missing" ? <DeductionButtons itemId={i.id} status={i.deduction_status} deductedAt={i.deducted_at} /> : null)}
      />

      <OfficerRequestActions requestId={request.id} status={request.status} itemIds={(items ?? []).map((i) => i.id)} />
    </div>
  );
}
