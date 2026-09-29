import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDoNotScrapClaims } from "@/lib/warranty-room/do-not-scrap";
import { buildDoNotScrapWorkbookBuffer } from "@/lib/warranty-room/do-not-scrap-workbook";

/**
 * Generates the xlsx entirely server-side and returns it as a plain file
 * response - some branches carry 20,000+ report rows, and passing that many
 * through a Server Action's RSC response (the previous approach) crashed in
 * production as an opaque "Minified React error #441" (a Server Component
 * render error, message stripped in production - confirmed via
 * react.dev/errors/441 and Next.js GitHub issues). A plain HTTP file
 * response has no such payload-shape constraint; only the compact xlsx
 * binary crosses the network, not raw JSON rows.
 */
export async function GET() {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();

  const [rows, { data: branch }] = await Promise.all([
    getDoNotScrapClaims(supabase, user.branch_id ?? ""),
    supabase.from("self_audit_branches").select("name").eq("id", user.branch_id ?? "").single(),
  ]);
  const buffer = await buildDoNotScrapWorkbookBuffer(rows);
  const claimCount = new Set(rows.map((r) => r.claim_number)).size;
  const branchSlug = (branch?.name ?? "branch").replace(/\s+/g, "_");

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Do_Not_Scrap_${branchSlug}_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "X-Claim-Count": String(claimCount),
      "X-Part-Count": String(rows.length),
    },
  });
}
