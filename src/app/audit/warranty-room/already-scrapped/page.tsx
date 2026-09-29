import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAlreadyScrappedClaims } from "@/lib/warranty-room/already-scrapped";
import { AlreadyScrappedTable } from "@/components/already-scrapped-table";

export default async function BranchAlreadyScrappedPage() {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();

  const [{ data: branch }, rows] = await Promise.all([
    supabase.from("self_audit_branches").select("name").eq("id", user.branch_id ?? "").single(),
    getAlreadyScrappedClaims(supabase, user.branch_id ?? ""),
  ]);

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <Link href="/audit/warranty-room" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to Warranty Room
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">Already scrapped</h1>
        <p className="text-sm text-neutral-600">
          Claims no longer pending - either destruction video was submitted, or the holding period had already
          exceeded 90 days by an earlier claims upload.
        </p>
      </div>

      <AlreadyScrappedTable branchName={branch?.name ?? ""} rows={rows} />
    </div>
  );
}
