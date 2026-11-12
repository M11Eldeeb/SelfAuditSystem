import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DocsError, downloadDoc } from "@/lib/documents/drive-docs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIME: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heic: "image/heic" };

/**
 * A self audit document from Google Drive (by its Drive file id), for officers and the branch it belongs to. Kept in
 * the browser for 30 days - documents never change once uploaded (a replacement is a new file).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const admin = createAdminClient();
  const [{ data: claimPhoto }, { data: opsPhoto }] = await Promise.all([
    admin.from("self_audit_audit_photos").select("storage_path, assignment_id").eq("drive_file_id", id).maybeSingle(),
    admin.from("self_audit_branch_operation_photos").select("storage_path, branch_id").eq("drive_file_id", id).maybeSingle(),
  ]);
  let branchId: string | null = opsPhoto?.branch_id ?? null;
  const path = claimPhoto?.storage_path ?? opsPhoto?.storage_path;
  if (claimPhoto) {
    const { data: a } = await admin.from("self_audit_audit_assignments").select("branch_id").eq("id", claimPhoto.assignment_id).maybeSingle();
    branchId = a?.branch_id ?? null;
  }
  if (!path) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const allowed = user.role === "officer" || user.role === "manager" || user.view_all || ((user.role === "branch_admin" || user.role === "service_manager") && user.branch_id === branchId);
  if (!allowed) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const ext = (path.split(".").pop() ?? "").toLowerCase();
  const mime = MIME[ext] ?? "application/octet-stream";
  try {
    const upstream = await downloadDoc(id, mime);
    if (!upstream.ok) return NextResponse.json({ error: "Could not read the file from Google Drive." }, { status: 502 });
    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=2592000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof DocsError ? e.message : "Could not reach Google Drive." }, { status: 502 });
  }
}
