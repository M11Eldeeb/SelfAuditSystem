import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { startWarrantyRoomBatch, type WarrantyRoomUploadKind } from "@/lib/warranty-room/upload";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (user.role !== "officer") {
    return NextResponse.json({ error: "Only warranty officers can upload." }, { status: 403 });
  }

  try {
    const { kind, filename, row_count } = (await request.json()) as {
      kind?: WarrantyRoomUploadKind;
      filename?: string;
      row_count?: number;
    };
    if (kind !== "claims_data" && kind !== "scrapped_parts") {
      return NextResponse.json({ error: "Malformed start request." }, { status: 400 });
    }
    const result = await startWarrantyRoomBatch(user.id, kind, String(filename ?? ""), Number(row_count) || 0);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Warranty room upload (start) failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? `Could not start the upload: ${err.message}` : "Could not start the upload." },
      { status: 500 }
    );
  }
}
