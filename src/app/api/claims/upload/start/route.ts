import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { startUploadBatch } from "@/lib/upload-claims";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (user.role !== "officer") {
    return NextResponse.json({ error: "Only warranty officers can upload claims." }, { status: 403 });
  }

  try {
    const { claim_month, filename, row_count } = await request.json();
    const result = await startUploadBatch(user.id, String(claim_month ?? ""), String(filename ?? ""), Number(row_count) || 0);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Claims upload (start) failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? `Could not start the upload: ${err.message}` : "Could not start the upload." },
      { status: 500 }
    );
  }
}
