"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type DecideScrapRequestState = { error?: string } | undefined;

const VALID_STATUSES = [
  "returned_to_branch",
  "rejected",
  "pending_manufacturer",
  "approved",
  "manufacturer_rejected",
  "manufacturer_returned",
];

export async function decideScrapRequest(
  scrapRequestId: string,
  _prev: DecideScrapRequestState,
  formData: FormData
): Promise<DecideScrapRequestState> {
  await requireRole("officer");
  const supabase = await createClient();

  const newStatus = String(formData.get("new_status") ?? "");
  if (!VALID_STATUSES.includes(newStatus)) return { error: "Unknown action." };
  const comment = String(formData.get("comment") ?? "").trim() || null;

  const { error } = await supabase.rpc("decide_scrap_request", {
    p_scrap_request_id: scrapRequestId,
    p_new_status: newStatus,
    p_comment: comment,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/warranty-room/scrap");
}
