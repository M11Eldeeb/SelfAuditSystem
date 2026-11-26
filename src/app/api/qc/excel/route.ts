import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listQc, qcBranchScope } from "@/lib/qc/server";
import { parseQcRange } from "@/lib/qc/range";
import { qcExportMarks, recordQcExport } from "@/lib/qc/supervisor";
import { qcWorkbook } from "@/lib/qc/excel";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * The QC reports of a list (same filters as the QC records page: status, period, branch, search) as one Excel workbook.
 * ?new=1 takes only the reports not exported yet. The quality supervisor's download is logged per report.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.must_change_password) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const p = new URL(request.url).searchParams;
  const all = !qcBranchScope(user);
  const branch = p.get("branch");
  const rows = await listQc(user, {
    status: p.get("status") ?? "all",
    q: p.get("q") ?? undefined,
    branchId: all && branch && UUID.test(branch) ? branch : undefined,
    range: parseQcRange(p.get("qc") ?? undefined, "all"),
    limit: 2000,
  });
  let ids = rows.map((r) => r.id);
  if (p.get("new") === "1") {
    const marks = await qcExportMarks(ids);
    ids = ids.filter((id) => !marks.has(id));
  }
  if (!ids.length) return NextResponse.json({ error: "No QC reports to export." }, { status: 404 });
  const bytes = await qcWorkbook(ids);
  await recordQcExport(user, ids, "excel");
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`QC reports ${day}.xlsx`)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
