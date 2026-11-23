import { createAdminClient } from "@/lib/supabase/admin";
import { siteOrigin } from "@/lib/site-origin";
import { agreementsTable, courtesyStaff, readFile, type Agreement } from "@/lib/courtesy/agreements-server";
import { courtesyPdf } from "@/lib/courtesy/pdf";
import { termsById } from "@/lib/courtesy/terms-server";

export const maxDuration = 60;

const format = (p: string): "png" | "jpg" => (p.toLowerCase().endsWith(".png") ? "png" : "jpg");

/** The agreement PDF, drawn on request (always the latest state). Staff of the branch, officers. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const s = await courtesyStaff();
  const { data } = await agreementsTable().select("*").eq("id", id).maybeSingle();
  const a = data as Agreement | null;
  if (!a || (s.branchId && a.branch_id !== s.branchId)) return new Response("Not found", { status: 404 });
  const { data: branch } = await createAdminClient().from("self_audit_branches").select("name").eq("id", a.branch_id).maybeSingle();
  const [customerSignature, advisorSignature, license, ...photos] = await Promise.all([readFile(a.customer_signature), readFile(a.advisor_signature), readFile(a.license_photo), ...a.photos.map(readFile)]);
  const returnPhotos = await Promise.all((a.return_photos ?? []).map(readFile));
  const area = s.user.role === "officer" ? "admin" : s.user.role === "branch_admin" ? "audit" : "advisor";
  const pdf = await courtesyPdf(a, branch?.name ?? "Branch", `${await siteOrigin()}/${area}/courtesy-cars/${a.id}`, {
    terms: await termsById(a.terms_id),
    customerSignature,
    advisorSignature,
    license: license && a.license_photo && !a.license_photo.endsWith(".webp") ? { data: license, format: format(a.license_photo) } : null,
    photos: photos.map((b, i) => (b && !a.photos[i].endsWith(".webp") ? { data: b, format: format(a.photos[i]) } : null)).filter((x): x is { data: Buffer; format: "png" | "jpg" } => !!x),
    returnPhotos: returnPhotos.map((b, i) => (b && !a.return_photos[i].endsWith(".webp") ? { data: b, format: format(a.return_photos[i]) } : null)).filter((x): x is { data: Buffer; format: "png" | "jpg" } => !!x),
  });
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Courtesy Car ${a.ref}.pdf"; filename*=UTF-8''${encodeURIComponent(`Courtesy Car ${a.ref} - ${a.customer_name.replace(/[^\p{L}\p{N} ]/gu, "")}.pdf`)}`, "Cache-Control": "private, no-store" },
  });
}
