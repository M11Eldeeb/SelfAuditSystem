import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { upsertClaimsChunk } from "@/lib/upload-claims";
import type { ParsedClaimRow } from "@/lib/parse-claims";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (user.role !== "officer") {
    return NextResponse.json({ error: "Only warranty officers can upload claims." }, { status: 403 });
  }

  try {
    const { batchId, claims } = (await request.json()) as { batchId?: string; claims?: ParsedClaimRow[] };
    if (!batchId || !Array.isArray(claims)) {
      return NextResponse.json({ error: "Malformed chunk request." }, { status: 400 });
    }
    const result = await upsertClaimsChunk(batchId, claims);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Claims upload (chunk) failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? `Chunk failed: ${err.message}` : "Chunk failed." },
      { status: 500 }
    );
  }
}
