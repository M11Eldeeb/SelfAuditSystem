import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { finishUpload } from "@/lib/upload-claims";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (user.role !== "officer") {
    return NextResponse.json({ error: "Only warranty officers can upload claims." }, { status: 403 });
  }

  try {
    const { batchId, totalClaims, filename } = (await request.json()) as {
      batchId?: string;
      totalClaims?: number;
      filename?: string;
    };
    if (!batchId) return NextResponse.json({ error: "Malformed finish request." }, { status: 400 });

    const result = await finishUpload(batchId, Number(totalClaims) || 0, String(filename ?? ""));
    if (result.success) revalidatePath("/admin/claims");
    return NextResponse.json(result);
  } catch (err) {
    console.error("Claims upload (finish) failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? `Could not finish the upload: ${err.message}` : "Could not finish the upload." },
      { status: 500 }
    );
  }
}
