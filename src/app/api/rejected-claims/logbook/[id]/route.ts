import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DriveError, downloadFile } from "@/lib/google-drive";
import { getLogbookFileId } from "@/lib/rejected-claims-logbook";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Opens an entry's logbook PDF (kept in Google Drive) through the website. The
 * entry is read as the signed-in user, so a branch admin only gets their own
 * branch's logbooks, and nothing while the diary is locked for them.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const supabase = await createClient();
  const { data: entry } = await supabase.from("self_audit_rejected_claims").select("branch_id, work_order_no").eq("id", id).maybeSingle();
  if (!entry) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const fileId = await getLogbookFileId(entry.branch_id, entry.work_order_no);
  if (!fileId) return NextResponse.json({ error: "The logbook is still being prepared - try again in a moment." }, { status: 404 });

  let upstream: Response;
  try {
    upstream = await downloadFile(fileId);
  } catch (e) {
    return NextResponse.json({ error: e instanceof DriveError ? e.message : "Could not reach Google Drive." }, { status: 502 });
  }
  if (!upstream.ok) return NextResponse.json({ error: "Could not read the logbook from Google Drive." }, { status: 502 });

  const download = new URL(request.url).searchParams.get("download") === "1";
  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(`Logbook - ${entry.work_order_no}.pdf`)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
