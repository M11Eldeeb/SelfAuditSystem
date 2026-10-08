import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintLabel } from "@/components/part-returns/print-label";

/**
 * Shared by the officer and branch print routes. Reads through the caller's
 * RLS, so a branch admin can only print their own branch's requests.
 * `items` is a comma-separated list of item ids; empty = every item.
 */
export async function PartReturnPrintPage({ id, itemsParam }: { id: string; itemsParam?: string }) {
  const supabase = await createClient();
  const [{ data: request }, { data: items }] = await Promise.all([
    supabase.from("self_audit_part_returns").select("*").eq("id", id).maybeSingle(),
    supabase.from("self_audit_part_return_items").select("*").eq("request_id", id).order("claim_number").order("part_no"),
  ]);
  if (!request) notFound();
  const { data: branch } = await supabase.from("self_audit_branches").select("name").eq("id", request.branch_id).maybeSingle();

  const wanted = new Set((itemsParam ?? "").split(",").filter(Boolean));
  const selected = (items ?? []).filter((i) => wanted.size === 0 || wanted.has(i.id));

  return <PrintLabel request={request} branchName={branch?.name ?? ""} items={selected} />;
}
