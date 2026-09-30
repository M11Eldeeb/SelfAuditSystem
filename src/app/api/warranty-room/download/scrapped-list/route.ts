import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAlreadyScrappedClaims } from "@/lib/warranty-room/already-scrapped";
import { buildAlreadyScrappedWorkbookBuffer } from "@/lib/warranty-room/already-scrapped-workbook";

/**
 * See src/app/api/warranty-room/download/do-not-scrap/route.ts for why this
 * is a file route, not a Server Action, and why maxDuration is set. Officers
 * pick any branch via ?branch=<id> (get_already_scrapped_claims itself also
 * enforces this - branch_admin can only ever pass their own branch_id);
 * branch admins always get their own branch regardless of the query param.
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
      getAlreadyScrappedClaims(supabase, branchId),
      supabase.from("self_audit_branches").select("name").eq("id", branchId).single(),
    ]);
    const buffer = await buildAlreadyScrappedWorkbookBuffer(rows);
    const claimCount = new Set(rows.map((r) => r.claim_number)).size;
    const branchSlug = (branch?.name ?? "branch").replace(/\s+/g, "_");

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Scrapped_List_${branchSlug}_${new Date().toISOString().slice(0, 10)}.xlsx"`,
        "X-Claim-Count": String(claimCount),
        "X-Part-Count": String(rows.length),
      },
    });
  } catch (err) {
    console.error("Scrapped list download failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not generate the report." },
      { status: 500 }
    );
  }
}
