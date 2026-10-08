import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { REQUEST_STATUS_LABELS, REQUEST_STATUS_TONE, requestLabel } from "@/lib/part-returns";
import { ItemsTable } from "@/components/part-returns/items-table";
import { flagsFor, getPartFlags } from "@/lib/part-return-flags";
import { BranchRequestForm } from "./branch-request-form";

export default async function BranchPartReturnPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("branch_admin");
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: request }, { data: items }] = await Promise.all([
    supabase.from("self_audit_part_returns").select("*").eq("id", id).maybeSingle(),
    supabase.from("self_audit_part_return_items").select("*").eq("request_id", id).order("claim_number").order("part_no"),
  ]);
  if (!request) notFound();
  // Request already confirmed as this branch's (RLS read above).
  const flagMap = await getPartFlags([...new Set((items ?? []).map((i) => i.claim_id).filter((c): c is string => !!c))]);
  const flags = Object.fromEntries((items ?? []).map((i) => [i.id, flagsFor(flagMap, i.claim_id, i.part_no)]));

  return (
    <div className="space-y-5">
      <div>
        <Link href="/audit/part-returns" className="text-sm text-neutral-500 hover:text-neutral-800">
          ← Part Return
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{requestLabel(request.request_no)}</h1>
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${REQUEST_STATUS_TONE[request.status]}`}>
            {REQUEST_STATUS_LABELS[request.status]}
          </span>
        </div>
        {request.officer_note && <p className="text-sm text-neutral-600">Note from warranty team: “{request.officer_note}”</p>}
      </div>

      {request.status === "open" ? (
        <BranchRequestForm requestId={request.id} items={items ?? []} flags={flags} />
      ) : (
        <>
          <p className="text-sm text-neutral-600">
            Closed{" "}
            {request.branch_closed_at &&
              new Date(request.branch_closed_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" })}
            {request.branch_waybill && (
              <>
                {" "}
                · waybill <span className="font-mono">{request.branch_waybill}</span>
              </>
            )}
          </p>
          <ItemsTable items={items ?? []} flags={flags} />
          <a
            href={`/audit/part-returns/${request.id}/print`}
            target="_blank"
            className="inline-block rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50"
          >
            Print claims & parts
          </a>
        </>
      )}
    </div>
  );
}
