"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type SubmitScrapRequestState = { error?: string } | undefined;

export async function submitScrapRequest(
  scrapRequestId: string,
  _prev: SubmitScrapRequestState,
  formData: FormData
): Promise<SubmitScrapRequestState> {
  await requireRole("branch_admin");
  const supabase = await createClient();

  const videoPath = String(formData.get("video_path") ?? "").trim();
  if (!videoPath) return { error: "Upload a video before submitting." };

  const { error } = await supabase.rpc("submit_scrap_request", {
    p_scrap_request_id: scrapRequestId,
    p_video_path: videoPath,
  });
  if (error) return { error: error.message };

  revalidatePath("/audit/warranty-room");
}

export type BulkSubmitResult = { requestId: string; claimNumber: string; error?: string };

/**
 * Submits many scrap requests at once, each with its own already-uploaded
 * video - the branch picks one video per claim, then everything goes in one
 * action instead of clicking submit per claim. Each request still goes
 * through the same submit_scrap_request RPC individually (atomic
 * check-then-write per claim), just looped server-side; one claim failing
 * (e.g. it was returned by the manufacturer in the meantime) doesn't block
 * the rest.
 */
export async function submitScrapRequestsBulk(mappings: { requestId: string; claimNumber: string; videoPath: string }[]): Promise<{
  results: BulkSubmitResult[];
}> {
  await requireRole("branch_admin");
  const supabase = await createClient();

  const results: BulkSubmitResult[] = [];
  for (const m of mappings) {
    const { error } = await supabase.rpc("submit_scrap_request", {
      p_scrap_request_id: m.requestId,
      p_video_path: m.videoPath,
    });
    results.push({ requestId: m.requestId, claimNumber: m.claimNumber, error: error?.message });
  }

  revalidatePath("/audit/warranty-room");
  return { results };
}

export type HandOverSupplierCollectionState = { error?: string } | undefined;

export async function handOverSupplierCollection(
  collectionId: string,
  _prev: HandOverSupplierCollectionState,
  formData: FormData
): Promise<HandOverSupplierCollectionState> {
  await requireRole("branch_admin");
  const supabase = await createClient();

  const branchRepName = String(formData.get("branch_rep_name") ?? "").trim();
  const supplierRepName = String(formData.get("supplier_rep_name") ?? "").trim();
  const signedPdfPath = String(formData.get("signed_pdf_path") ?? "").trim();
  const videoPath = String(formData.get("video_path") ?? "").trim();

  if (!branchRepName) return { error: "Enter the branch representative name." };
  if (!supplierRepName) return { error: "Enter the supplier representative name." };
  if (!signedPdfPath) return { error: "Upload the signed document." };
  if (!videoPath) return { error: "Upload a video." };

  const { error } = await supabase.rpc("hand_over_supplier_collection", {
    p_collection_id: collectionId,
    p_branch_rep_name: branchRepName,
    p_supplier_rep_name: supplierRepName,
    p_signed_pdf_path: signedPdfPath,
    p_video_path: videoPath,
  });
  if (error) return { error: error.message };

  revalidatePath("/audit/warranty-room");
}
