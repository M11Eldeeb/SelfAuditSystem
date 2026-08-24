import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export type PhotoStatus = { url: string } | { removed: true };

/**
 * Signs a URL for each still-present photo and marks cleaned-up ones as
 * "removed" instead, so the UI can tell that apart from "never uploaded".
 */
export async function buildPhotoStatusMap(
  supabase: SupabaseClient<Database>,
  photos: { photo_type_id: string; storage_path: string; deleted_at: string | null }[],
  ttlSeconds = 3600
): Promise<Map<string, PhotoStatus>> {
  const map = new Map<string, PhotoStatus>();
  for (const photo of photos) {
    if (photo.deleted_at) {
      map.set(photo.photo_type_id, { removed: true });
      continue;
    }
    const { data: signed } = await supabase.storage
      .from("audit-photos")
      .createSignedUrl(photo.storage_path, ttlSeconds);
    if (signed?.signedUrl) map.set(photo.photo_type_id, { url: signed.signedUrl });
  }
  return map;
}
