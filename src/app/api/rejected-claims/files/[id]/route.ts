import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { REJECTED_BUCKET } from "@/lib/rejected-claims";
import { DriveError, downloadFile } from "@/lib/google-drive";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Serves a diary attachment from Google Drive. Access is decided by the
 * database: the attachment row is read as the signed-in user, so a branch admin
 * gets nothing for another branch's entry (or while the diary is still locked
 * for branch admins). Add ?download=1 to force a download instead of showing it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const supabase = await createClient();
  const { data: att } = await supabase.from("self_audit_rejected_claim_attachments").select("*").eq("id", id).maybeSingle();
  if (!att) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Older files kept in the Supabase bucket: send to a short-lived signed link.
  if (att.storage === "supabase" && att.storage_path) {
    const { data } = await supabase.storage.from(REJECTED_BUCKET).createSignedUrl(att.storage_path, 300);
    return data?.signedUrl ? NextResponse.redirect(data.signedUrl) : NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (!att.drive_file_id) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let upstream: Response;
  try {
    upstream = await downloadFile(att.drive_file_id, request.headers.get("range"));
  } catch (e) {
    const message = e instanceof DriveError ? e.message : "Could not reach Google Drive.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  if (upstream.status === 404) return NextResponse.json({ error: "This file was removed from Google Drive." }, { status: 404 });
  if (!upstream.ok && upstream.status !== 206) return NextResponse.json({ error: "Could not read the file from Google Drive." }, { status: 502 });

  const forceDownload = new URL(request.url).searchParams.get("download") === "1";
  // SVG can carry scripts, so it is never displayed inline from our own domain.
  const inline = !forceDownload && att.mime_type !== "image/svg+xml";
  const filename = encodeURIComponent(att.file_name);

  const headers = new Headers({
    "Content-Type": att.mime_type,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${filename}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'",
    "Accept-Ranges": "bytes",
  });
  for (const h of ["Content-Length", "Content-Range"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new NextResponse(upstream.body, { status: upstream.status === 206 ? 206 : 200, headers });
}
