import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DocsError, downloadDoc, exportMimeFor } from "@/lib/documents/drive-docs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Shown in the browser; anything else is downloaded. (SVG and HTML never inline: they can carry scripts.) */
const INLINE = /^(application\/pdf|image\/(png|jpe?g|gif|webp|bmp)|video\/|audio\/|text\/plain)/;

/**
 * Serves a Warranty / Technical Documents file from Google Drive to any signed-in user - only files that are in the
 * two document folders (the index) can be fetched. Google Docs / Sheets / Slides come as PDF. ?download=1 downloads.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[\w-]{10,100}$/.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: doc } = await createAdminClient().from("self_audit_docs_index").select("name, mime_type, is_folder").eq("drive_id", id).maybeSingle();
  if (!doc || doc.is_folder) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let upstream: Response;
  try {
    upstream = await downloadDoc(id, doc.mime_type, request.headers.get("range"));
  } catch (e) {
    return NextResponse.json({ error: e instanceof DocsError ? e.message : "Could not reach Google Drive." }, { status: 502 });
  }
  if (upstream.status === 404) return NextResponse.json({ error: "This file was removed from Google Drive." }, { status: 404 });
  if (!upstream.ok && upstream.status !== 206) return NextResponse.json({ error: "Could not read the file from Google Drive." }, { status: 502 });

  const exported = exportMimeFor(doc.mime_type);
  const type = exported ?? doc.mime_type;
  const name = exported && !/\.pdf$/i.test(doc.name) ? `${doc.name}.pdf` : doc.name;
  const inline = new URL(request.url).searchParams.get("download") !== "1" && INLINE.test(type);
  const headers = new Headers({
    "Content-Type": type,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  });
  // The browser's own PDF viewer does not run inside a sandbox; every other type is shown sandboxed.
  if (type !== "application/pdf") headers.set("Content-Security-Policy", "sandbox; default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'");
  for (const h of ["Content-Length", "Content-Range"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new NextResponse(upstream.body, { status: upstream.status === 206 ? 206 : 200, headers });
}
