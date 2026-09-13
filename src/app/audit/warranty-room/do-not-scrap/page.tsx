import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDoNotScrapClaims } from "@/lib/warranty-room/do-not-scrap";
import { DoNotScrapTable } from "@/components/do-not-scrap-table";

export default async function BranchDoNotScrapPage() {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();

  const [{ data: branch }, rows] = await Promise.all([
    supabase.from("self_audit_branches").select("name").eq("id", user.branch_id ?? "").single(),
    getDoNotScrapClaims(supabase, user.branch_id ?? ""),
  ]);

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <Link href="/audit/warranty-room" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to Warranty Room
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">Do not scrap</h1>
        <p className="text-sm text-neutral-600">Claims to keep on hand - not flagged to scrap, not already scrapped.</p>
      </div>

      <DoNotScrapTable branchName={branch?.name ?? ""} rows={rows} />
    </div>
  );
}
