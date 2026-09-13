import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/** Signs a URL for a file in the "warranty-room-files" bucket, or null if there's no path. */
export async function getWarrantyRoomFileUrl(
  supabase: SupabaseClient<Database>,
  path: string | null,
  ttlSeconds = 3600
): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from("warranty-room-files").createSignedUrl(path, ttlSeconds);
  return data?.signedUrl ?? null;
}
