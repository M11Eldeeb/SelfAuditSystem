"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Queues a scrap list generation from the latest claims batch. The work runs
 * in the database within about a minute (run_requested_scrap_generation via
 * pg_cron) - never on upload, only when the officer asks for it here.
 */
export async function requestScrapGeneration(): Promise<{ error?: string }> {
  const officer = await requireRole("officer");
  const supabase = await createClient();

  const { data: busy } = await supabase.from("self_audit_scrap_generations").select("id").in("status", ["queued", "running"]).limit(1);
  if (busy?.length) return { error: "A generation is already queued or running." };

  const { data: batch } = await supabase
    .from("self_audit_upload_batches")
    .select("id, source_filename")
    .not("source_filename", "like", "[warranty-room:%")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!batch) return { error: "Upload a claims batch first." };

  const { error } = await supabase
    .from("self_audit_scrap_generations")
    .insert({ batch_id: batch.id, batch_name: batch.source_filename, requested_by: officer.id });
  if (error) return { error: error.message };

  revalidatePath("/admin/warranty-room");
  return {};
}
