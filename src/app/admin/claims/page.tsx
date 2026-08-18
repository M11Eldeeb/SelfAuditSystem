import { createClient } from "@/lib/supabase/server";
import { UploadForm } from "./upload-form";

export default async function ClaimsPage() {
  const supabase = await createClient();

  const [{ data: batches }, { data: claims }, { data: branches }] = await Promise.all([
    supabase.from("upload_batches").select("*").order("uploaded_at", { ascending: false }).limit(20),
    supabase.from("claims").select("*").order("creation_date", { ascending: false }).limit(100),
    supabase.from("branches").select("id, name"),
  ]);

  const branchNameById = new Map((branches ?? []).map((b) => [b.id, b.name]));

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Upload claims</h1>
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <UploadForm />
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

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Recent claims</h2>
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-2">Branch</th>
                <th className="px-4 py-2">Claim #</th>
                <th className="px-4 py-2">VIN</th>
                <th className="px-4 py-2">Creation date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {(claims ?? []).map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 text-neutral-900">
                    {branchNameById.get(c.branch_id) ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-neutral-600">{c.claim_number}</td>
                  <td className="px-4 py-2 text-neutral-600">{c.vin ?? "—"}</td>
                  <td className="px-4 py-2 text-neutral-600">{c.creation_date}</td>
                </tr>
              ))}
              {(claims ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-neutral-400">
                    No claims uploaded yet.
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
