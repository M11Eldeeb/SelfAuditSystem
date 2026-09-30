import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFlaggedToScrapClaims } from "@/lib/warranty-room/flagged-to-scrap";
import { buildFlaggedToScrapWorkbookBuffer } from "@/lib/warranty-room/flagged-to-scrap-workbook";

/** See src/app/api/warranty-room/download/do-not-scrap/route.ts for why this is a file route, not a Server Action, and why maxDuration is set. */
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
      getFlaggedToScrapClaims(supabase, branchId),
      supabase.from("self_audit_branches").select("name").eq("id", branchId).single(),
    ]);
    const buffer = await buildFlaggedToScrapWorkbookBuffer(rows);
    const claimCount = new Set(rows.map((r) => r.claim_number)).size;
    const branchSlug = (branch?.name ?? "branch").replace(/\s+/g, "_");

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Flagged_To_Scrap_${branchSlug}_${new Date().toISOString().slice(0, 10)}.xlsx"`,
        "X-Claim-Count": String(claimCount),
        "X-Part-Count": String(rows.length),
      },
    });
  } catch (err) {
    console.error("Flagged to scrap download failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not generate the report." },
      { status: 500 }
    );
  }
}
