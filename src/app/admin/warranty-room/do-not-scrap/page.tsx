import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDoNotScrapClaims } from "@/lib/warranty-room/do-not-scrap";
import { DoNotScrapTable } from "@/components/do-not-scrap-table";

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
  const rows = selectedBranch ? await getDoNotScrapClaims(supabase, selectedBranch) : [];
  const branchName = (branches ?? []).find((b) => b.id === selectedBranch)?.name ?? "";

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Do not scrap</h1>
        <p className="text-sm text-neutral-600">
          Claims with parts on hand that were never flagged to be scrapped and aren&apos;t already
          scrapped - the branch should hold onto these.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="space-y-1">
          <label htmlFor="branch" className="text-xs font-medium text-neutral-700">
            Branch
          </label>
          <select
            id="branch"
            name="branch"
            defaultValue={selectedBranch}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
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
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Apply
        </button>
      </form>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-900 print:block">{branchName}</h2>
        <DoNotScrapTable branchName={branchName} rows={rows} />
      </div>
    </div>
  );
}
