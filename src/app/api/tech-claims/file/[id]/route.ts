import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { DocsError, docsFetch, downloadDoc } from "@/lib/documents/drive-docs";
import { driveFileInfo } from "@/lib/tech-claims/drive";
import { techClaimFileFor } from "@/lib/tech-claims/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INLINE = /^(application\/pdf|image\/(png|jpe?g|gif|webp|bmp|heic|heif)|video\/)/;

/**
 * A technician claim's photo / video / PDF from Google Drive, for the people who may see that claim. Videos stream in
 * ranges (the browser only fetches what it plays). ?thumb=1 gives Drive's small preview image; ?download=1 downloads.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const file = await techClaimFileFor(user, id);
  if (!file) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const url = new URL(request.url);

  try {
    if (url.searchParams.get("thumb") === "1") {
      const info = await driveFileInfo(file.driveId);
      if (!info?.thumbnailLink) return new NextResponse(null, { status: 404 });
      const t = await docsFetch(info.thumbnailLink.replace(/=s\d+$/, "=s400"));
      if (!t.ok) return new NextResponse(null, { status: 404 });
      return new NextResponse(t.body, { headers: { "Content-Type": t.headers.get("Content-Type") ?? "image/jpeg", "Cache-Control": "private, max-age=86400" } });
    }

    const upstream = await downloadDoc(file.driveId, file.mimeType, request.headers.get("range"));
    if (upstream.status === 404) return NextResponse.json({ error: "This file was removed from Google Drive." }, { status: 404 });
    if (!upstream.ok && upstream.status !== 206) return NextResponse.json({ error: "Could not read the file from Google Drive." }, { status: 502 });
    const inline = url.searchParams.get("download") !== "1" && INLINE.test(file.mimeType);
    const headers = new Headers({
      "Content-Type": file.mimeType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
    });
    if (file.mimeType !== "application/pdf") headers.set("Content-Security-Policy", "sandbox; default-src 'none'; media-src 'self'; img-src 'self'; style-src 'unsafe-inline'");
    for (const h of ["Content-Length", "Content-Range"]) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new NextResponse(upstream.body, { status: upstream.status === 206 ? 206 : 200, headers });
  } catch (e) {
    return NextResponse.json({ error: e instanceof DocsError ? e.message : "Could not reach Google Drive." }, { status: 502 });
  }
}
