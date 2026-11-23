import { NextResponse } from "next/server";
import { branchByCode } from "@/lib/queue/server";
import { courtesyStaff } from "@/lib/courtesy/agreements-server";
import { renderCourtesyPoster } from "@/lib/queue/poster";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The branch's courtesy car poster (QR code + guide) as a PDF - staff of the branch and officers. ?download=1 downloads it. */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const s = await courtesyStaff();
  const { code } = await params;
  const branch = await branchByCode(code);
  if (!branch || (s.branchId && s.branchId !== branch.id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const origin = new URL(request.url).origin;
  const bytes = await renderCourtesyPoster(branch, `${origin}/cc/${branch.queue_code}`);
  const name = `Courtesy car - ${branch.name}.pdf`;
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
