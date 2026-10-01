import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ReportDownloadButton } from "@/components/report-download-button";

export default async function DoNotScrapPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  await requireRole("officer");
  const supabase = await createClient();
  const { branch: branchId } = await searchParams;

  const { data: branches } = await supabase.from("self_audit_branches").select("id, name, code").order("name");
  const selectedBranch = branchId || branches?.[0]?.id || "";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/warranty-room" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to Warranty Room
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">Do not scrap</h1>
        <p className="text-sm text-neutral-600">
          Claims with parts on hand that were never flagged to be scrapped and aren&apos;t already
          scrapped - the branch should hold onto these.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="branch" className="text-xs font-medium text-neutral-700">
            Branch
          </label>
          <select
            id="branch"
            name="branch"
            defaultValue={selectedBranch}
            className="rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-sm"
          >
            {(branches ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Apply
        </button>
      </form>

      <ReportDownloadButton
        endpoint="/api/warranty-room/download/do-not-scrap"
        branchId={selectedBranch}
        label="Do not scrap list"
        description="Claims to keep on hand - not flagged to scrap, not already scrapped. Downloads as Excel."
        filenameFallback="Do_Not_Scrap.xlsx"
      />
    </div>
  );
}
