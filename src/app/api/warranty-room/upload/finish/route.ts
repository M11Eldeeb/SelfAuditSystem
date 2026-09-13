import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { finishWarrantyRoomBatch } from "@/lib/warranty-room/upload";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (user.role !== "officer") {
    return NextResponse.json({ error: "Only warranty officers can upload." }, { status: 403 });
  }

  try {
    const { batchId, totalRows, filename } = (await request.json()) as {
      batchId?: string;
      totalRows?: number;
      filename?: string;
    };
    if (!batchId) return NextResponse.json({ error: "Malformed finish request." }, { status: 400 });

    const result = await finishWarrantyRoomBatch(batchId, Number(totalRows) || 0, String(filename ?? ""));
    revalidatePath("/admin/warranty-room");
    return NextResponse.json(result);
  } catch (err) {
    console.error("Warranty room upload (finish) failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? `Could not finish the upload: ${err.message}` : "Could not finish the upload." },
      { status: 500 }
    );
  }
}
