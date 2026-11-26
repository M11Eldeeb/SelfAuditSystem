import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getQcDetail } from "@/lib/qc/server";
import { renderQcReport } from "@/lib/qc/pdf";
import { recordQcExport } from "@/lib/qc/supervisor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The QC report as a PDF (to view, print or save), for the people who may see that QC. ?download=1 downloads it. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const qc = await getQcDetail(user, id);
  if (!qc) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const bytes = await renderQcReport(qc);
  const name = `${qc.qc_no} - ${qc.wip_no} - QC report.pdf`;
  const download = new URL(request.url).searchParams.get("download") === "1";
  // A download (not a look in the browser) by the quality supervisor marks the report as exported.
  if (download) await recordQcExport(user, [qc.id], "pdf");
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
