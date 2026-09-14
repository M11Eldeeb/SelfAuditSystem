import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  upsertClaimsChunk,
  upsertClaimPartsChunk,
  insertScrappedPartsChunk,
  upsertScrapRequestsChunk,
  upsertSupplierPartsChunk,
} from "@/lib/warranty-room/upload";
import type { ParsedClaimRow } from "@/lib/parse-claims";
import type { ParsedClaimPartRow } from "@/lib/warranty-room/parse-claim-parts";
import type { ParsedScrappedPartRow } from "@/lib/warranty-room/parse-scrapped-parts";
import type { ParsedScrapRequestRow } from "@/lib/warranty-room/parse-scrap-requests";
import type { ParsedSupplierPartRow } from "@/lib/warranty-room/parse-supplier-parts";

type ChunkTable = "claims" | "claim_parts" | "scrapped_parts" | "scrap_requests" | "supplier_parts";

export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (user.role !== "officer") {
    return NextResponse.json({ error: "Only warranty officers can upload." }, { status: 403 });
  }

  try {
    const { batchId, table, rows, collectionDate } = (await request.json()) as {
      batchId?: string;
      table?: ChunkTable;
      rows?: unknown[];
      collectionDate?: string | null;
    };
    if (!batchId || !Array.isArray(rows)) {
      return NextResponse.json({ error: "Malformed chunk request." }, { status: 400 });
    }

    if (table === "claims") {
      const result = await upsertClaimsChunk(batchId, rows as ParsedClaimRow[]);
      return NextResponse.json(result);
    }
    if (table === "claim_parts") {
      const result = await upsertClaimPartsChunk(batchId, rows as ParsedClaimPartRow[]);
      return NextResponse.json(result);
    }
    if (table === "scrapped_parts") {
      const result = await insertScrappedPartsChunk(batchId, rows as ParsedScrappedPartRow[]);
      return NextResponse.json(result);
    }
    if (table === "scrap_requests") {
      const result = await upsertScrapRequestsChunk(batchId, rows as ParsedScrapRequestRow[]);
      return NextResponse.json(result);
    }
    if (table === "supplier_parts") {
      const result = await upsertSupplierPartsChunk(batchId, collectionDate ?? null, rows as ParsedSupplierPartRow[]);
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "Unknown chunk table." }, { status: 400 });
  } catch (err) {
    console.error("Warranty room upload (chunk) failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? `Chunk failed: ${err.message}` : "Chunk failed." },
      { status: 500 }
    );
  }
}
