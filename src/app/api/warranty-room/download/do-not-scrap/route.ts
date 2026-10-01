import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
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
 *
 * maxDuration matches the other Warranty Room routes (upload/start etc.) -
 * without it this defaults to the platform's standard timeout, which a
 * large branch's row count (tens of thousands) plus ExcelJS's in-memory
 * workbook build can plausibly exceed.
 *
 * Officers pick any branch via ?branch=<id>; branch admins always get their
 * own branch regardless of the query param (same pattern as the other two
 * Warranty Room report routes).
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const requestedBranchId = new URL(request.url).searchParams.get("branch");
  const branchId = user.role === "officer" ? (requestedBranchId ?? "") : (user.branch_id ?? "");
  if (!branchId) return NextResponse.json({ error: "No branch specified." }, { status: 400 });

  try {
    const supabase = await createClient();
    const [rows, { data: branch }] = await Promise.all([
      getDoNotScrapClaims(supabase, branchId),
      supabase.from("self_audit_branches").select("name").eq("id", branchId).single(),
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
  } catch (err) {
    console.error("Do not scrap download failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not generate the report." },
      { status: 500 }
    );
  }
}
