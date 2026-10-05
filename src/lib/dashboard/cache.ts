import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClaimSide, type ClaimSide } from "@/lib/dashboard/kpis";

export const DASHBOARD_CLAIMS_TAG = "dashboard-claims";

const cachedClaimSide = unstable_cache(
  async (branchesKey: string, from: string, to: string): Promise<ClaimSide> =>
    getClaimSide(createAdminClient(), { branches: JSON.parse(branchesKey), from, to }),
  ["dashboard-claim-side-v1"],
  // Claims only change on upload (which expires this tag right away) and
  // scrap requests on the nightly cron - 10 minutes is a safety net.
  { revalidate: 600, tags: [DASHBOARD_CLAIMS_TAG] }
);

/**
 * The slow claims side of the dashboard, cached across requests and users.
 * Runs on the service-role client because a cache entry can't carry a
 * session - so the caller MUST pass only branches the viewer may see (a
 * branch admin: their own branch only, enforced by the page).
 */
export function getCachedClaimSide(branches: { id: string; name: string }[], from: string, to: string): Promise<ClaimSide> {
  const key = JSON.stringify([...branches].sort((a, b) => a.id.localeCompare(b.id)).map(({ id, name }) => ({ id, name })));
  return cachedClaimSide(key, from, to);
}
