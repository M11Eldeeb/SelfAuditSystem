import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ScrappingListDownloadButton } from "@/components/scrapping-list-download-button";

export default async function OfficerScrappingListPage({
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
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Scrapping list</h1>
        <p className="text-sm text-neutral-600">
          Every claim flagged to scrap, presumed scrapped, or scrapped for the selected branch.
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

      <ScrappingListDownloadButton branchId={selectedBranch} />
    </div>
  );
}
