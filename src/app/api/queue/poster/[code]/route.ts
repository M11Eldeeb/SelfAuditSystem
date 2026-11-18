import { NextResponse } from "next/server";
import { branchByCode, canUseBranch, getQueueAccess } from "@/lib/queue/server";
import { renderQueuePoster } from "@/lib/queue/poster";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The branch's reception poster (QR code + guide) as a PDF, for the queue managers of that branch and head office. ?download=1 downloads it. */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const a = await getQueueAccess();
  if (!a) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { code } = await params;
  const branch = await branchByCode(code);
  if (!branch || !canUseBranch(a, branch.id) || a.role !== "manager") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const origin = new URL(request.url).origin;
  const bytes = await renderQueuePoster(branch, `${origin}/q/${branch.queue_code}`);
  const name = `Customer queue - ${branch.name}.pdf`;
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
