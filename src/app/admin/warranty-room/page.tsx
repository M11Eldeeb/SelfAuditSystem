import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ClaimsDataUploadForm } from "./claims-data-upload-form";
import { ScrappedPartsUploadForm } from "./scrapped-parts-upload-form";

export default async function WarrantyRoomPage() {
  await requireRole("officer");
  const supabase = await createClient();

  const [{ data: branches }, { count: claimPartsCount }, { count: scrappedPartsCount }] = await Promise.all([
    supabase.from("self_audit_branches").select("id, name, code").order("name"),
    supabase.from("self_audit_claim_parts").select("id", { count: "exact", head: true }),
    supabase.from("self_audit_scrapped_parts").select("id", { count: "exact", head: true }),
  ]);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Warranty Room</h1>
        <p className="text-sm text-neutral-600">
          Tracks what happens to a claim&apos;s removed parts after settlement: already scrapped, queued to
          be scrapped, reserved for the manufacturer&apos;s supplier to collect, or kept (not scrapped).
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900">1. All claims data</h2>
        <ClaimsDataUploadForm branches={branches ?? []} />
        <p className="text-xs text-neutral-500">{claimPartsCount ?? 0} part row(s) on file across all claims.</p>
      </section>

      <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900">2. Parts already scraped</h2>
        <ScrappedPartsUploadForm branches={branches ?? []} />
        <p className="text-xs text-neutral-500">{scrappedPartsCount ?? 0} already-scrapped part row(s) on file.</p>
      </section>

      <section className="space-y-2 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-4">
        <h2 className="text-sm font-semibold text-neutral-700">Coming next</h2>
        <p className="text-xs text-neutral-500">
          Parts should be scraped (with the scrap review/approval workflow), supplier parts (with the
          sign-and-hand-over workflow), and the do-not-scrap report.
        </p>
      </section>
    </div>
  );
}
