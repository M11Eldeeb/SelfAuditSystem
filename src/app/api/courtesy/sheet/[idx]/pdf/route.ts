import { courtesyStaff } from "@/lib/courtesy/agreements-server";
import { loadCourtesy } from "@/lib/courtesy/sheet";
import { branchResolver } from "@/lib/courtesy/branches";
import { sheetRowAsAgreement } from "@/lib/courtesy/sheet-agreement";
import { courtesyPdf } from "@/lib/courtesy/pdf";

export const maxDuration = 60;

/** An old agreement of the other application (a row of the courtesy cars sheet) printed as the portal's agreement PDF. */
export async function GET(req: Request, { params }: { params: Promise<{ idx: string }> }) {
  const s = await courtesyStaff();
  const { idx } = await params;
  const i = Number(idx);
  if (!Number.isInteger(i) || i < 0) return new Response("Not found", { status: 404 });
  const [sheet, resolve] = await Promise.all([loadCourtesy(), branchResolver()]);
  const c = sheet.cols.agreements;
  const row = sheet.agreements?.rows[i];
  if (!row) return new Response("Not found", { status: 404 });
  // The row must still be the one that was searched (the sheet may have moved since).
  const ref = new URL(req.url).searchParams.get("ref") ?? "";
  if (ref && ![c.agreement >= 0 ? row[c.agreement] : "", c.plate >= 0 ? row[c.plate] : ""].includes(ref)) return new Response("The sheet changed - search again.", { status: 409 });
  const branch = c.branch >= 0 ? resolve(row[c.branch]) : null;
  if (s.branchId && branch?.id !== s.branchId) return new Response("Not found", { status: 404 });
  const mapped = sheetRowAsAgreement(sheet, i, branch?.id ?? "");
  if (!mapped) return new Response("Not found", { status: 404 });
  const pdf = await courtesyPdf(mapped.agreement, branch?.name ?? (c.branch >= 0 ? row[c.branch] : "Branch"), new URL(req.url).origin, {
    customerSignature: null,
    advisorSignature: null,
    license: null,
    photos: [],
    fromSheet: { extra: mapped.extra },
  });
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Courtesy Car ${mapped.agreement.ref.replace(/[^\p{L}\p{N} -]/gu, "")}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
