import { createClient } from "@/lib/supabase/server";
import { UploadForm } from "./upload-form";

export default async function ClaimsPage() {
  const supabase = await createClient();

  const [{ data: batches }, { data: branches }] = await Promise.all([
    supabase.from("self_audit_upload_batches").select("*").order("uploaded_at", { ascending: false }).limit(20),
    supabase.from("self_audit_branches").select("id, name, code").order("name"),
  ]);

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Upload claims</h1>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <UploadForm branches={branches ?? []} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Upload history</h2>
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
                  <td className="px-4 py-2 text-neutral-600">
                    {new Date(b.uploaded_at).toLocaleString()}
                  </td>
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
    </div>
  );
}
