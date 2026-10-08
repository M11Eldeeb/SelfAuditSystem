import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RequestBuilder } from "./request-builder";

export default async function NewPartReturnPage() {
  await requireRole("officer");
  const supabase = await createClient();
  const { data: branches } = await supabase.from("self_audit_branches").select("id, name, active").order("name");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/part-returns" className="text-sm text-neutral-500 hover:text-neutral-800">
          ← Part Return
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">New part return request</h1>
        <p className="text-sm text-neutral-600">
          Enter the claims the manufacturer asked for, tick the parts to return, and send. One request is created per branch.
        </p>
      </div>
      <RequestBuilder branches={(branches ?? []).filter((b) => b.active).map(({ id, name }) => ({ id, name }))} />
    </div>
  );
}
