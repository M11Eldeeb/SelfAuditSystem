import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ClaimsUploadForm } from "./claims-upload-form";
import { ScrappedPartsUploadForm } from "./scrapped-parts-upload-form";
import { ScrapRequestsUploadForm } from "./scrap-requests-upload-form";
import { SupplierPartsUploadForm } from "./supplier-parts-upload-form";

export default async function WarrantyRoomPage() {
  await requireRole("officer");
  const supabase = await createClient();

  const [
    { data: branches },
    { count: claimPartsCount },
    { count: scrappedPartsCount },
    { count: scrapRequestsCount },
    { count: supplierCollectionsCount },
    { data: batches },
    { count: scrapPendingCount },
  ] = await Promise.all([
    supabase.from("self_audit_branches").select("id, name, code").order("name"),
    supabase.from("self_audit_claim_parts").select("id", { count: "exact", head: true }),
    supabase.from("self_audit_scrapped_parts").select("id", { count: "exact", head: true }),
    supabase.from("self_audit_scrap_requests").select("id", { count: "exact", head: true }),
    supabase.from("self_audit_supplier_collections").select("id", { count: "exact", head: true }),
    supabase.from("self_audit_upload_batches").select("*").order("uploaded_at", { ascending: false }).limit(20),
    supabase
      .from("self_audit_scrap_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending_review", "pending_manufacturer"]),
  ]);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Warranty Room</h1>
        <p className="text-sm text-neutral-600">
          Claims data, and what happens to a claim&apos;s removed parts after settlement: already
          scrapped, queued to be scrapped, reserved for the manufacturer&apos;s supplier to collect, or
          kept (not scrapped).
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900">1. All claims data</h2>
        <ClaimsUploadForm branches={branches ?? []} />
        <p className="text-xs text-neutral-500">{claimPartsCount ?? 0} part detail row(s) on file across all claims.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-700">Upload history</h2>
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-2">File</th>
                <th className="px-4 py-2">Claims month</th>
                <th className="px-4 py-2">Rows</th>
                <th className="px-4 py-2">Uploaded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {(batches ?? []).map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-2 text-neutral-900">{b.source_filename}</td>
                  <td className="px-4 py-2 text-neutral-600">{b.claim_month.slice(0, 7)}</td>
                  <td className="px-4 py-2 text-neutral-600">{b.row_count}</td>
                  <td className="px-4 py-2 text-neutral-600">{new Date(b.uploaded_at).toLocaleString()}</td>
                </tr>
              ))}
              {(batches ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-neutral-400">
                    No uploads yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900">2. Parts already scraped</h2>
        <ScrappedPartsUploadForm branches={branches ?? []} />
        <p className="text-xs text-neutral-500">{scrappedPartsCount ?? 0} already-scrapped part row(s) on file.</p>
      </section>

      <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900">3. Parts should be scraped</h2>
        <ScrapRequestsUploadForm branches={branches ?? []} />
        <p className="text-xs text-neutral-500">
          {scrapRequestsCount ?? 0} scrap request(s) on file &middot;{" "}
          <Link href="/admin/warranty-room/scrap" className="text-brand hover:underline">
            {scrapPendingCount ?? 0} awaiting review or manufacturer decision →
          </Link>
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900">4. Supplier parts</h2>
        <SupplierPartsUploadForm branches={branches ?? []} />
        <p className="text-xs text-neutral-500">{supplierCollectionsCount ?? 0} supplier collection(s) on file.</p>
      </section>

      <section className="space-y-2 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-4">
        <h2 className="text-sm font-semibold text-neutral-700">Coming next</h2>
        <p className="text-xs text-neutral-500">
          The supplier parts sign/hand-over workflow, and the do-not-scrap report.
        </p>
      </section>
    </div>
  );
}
