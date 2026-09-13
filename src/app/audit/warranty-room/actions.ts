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
