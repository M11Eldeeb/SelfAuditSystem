import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getQcDetail } from "@/lib/qc/server";
import { recordQcExport } from "@/lib/qc/supervisor";
import { qcWorkbook } from "@/lib/qc/excel";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** One QC report as an Excel workbook, for the people who may see that QC (the quality supervisor's download is logged). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || user.must_change_password) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const qc = await getQcDetail(user, id);
  if (!qc) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const bytes = await qcWorkbook([qc.id]);
  await recordQcExport(user, [qc.id], "excel");
  const name = `${qc.qc_no} - ${qc.wip_no} - QC report.xlsx`;
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
