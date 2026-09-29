"use server";

import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDoNotScrapClaims, type DoNotScrapRow } from "@/lib/warranty-room/do-not-scrap";
import { getAlreadyScrappedClaims, type AlreadyScrappedRow } from "@/lib/warranty-room/already-scrapped";

/** Own-branch only - requireRole plus the RPCs' own branch_id check below both enforce this. */
export async function fetchDoNotScrapRows(): Promise<DoNotScrapRow[]> {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();
  return getDoNotScrapClaims(supabase, user.branch_id ?? "");
}

export async function fetchScrappingListRows(): Promise<AlreadyScrappedRow[]> {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();
  return getAlreadyScrappedClaims(supabase, user.branch_id ?? "");
}
