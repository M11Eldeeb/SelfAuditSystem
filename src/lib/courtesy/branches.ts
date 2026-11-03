import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { JIAD_DEALER_CODE_SUFFIX_MAP } from "@/lib/parse-claims";
import { branchCodeIn } from "./sheet";

/** "A7 ...", "HER", "Jeddah Heraa" -> the portal's branch name. */
export async function branchResolver() {
  const { data } = await createAdminClient().from("self_audit_branches").select("id, name, code");
  const list = (data ?? []).map((b) => ({ id: b.id, name: b.name, code: (b.code ?? "").toUpperCase() }));
  return (cell: string): { id: string; name: string } | null => {
    const v = cell.trim();
    if (!v) return null;
    const dealer = branchCodeIn(v);
    if (dealer) {
      const b = list.find((x) => x.code === JIAD_DEALER_CODE_SUFFIX_MAP[dealer]);
      if (b) return b;
    }
    const up = v.toUpperCase();
    return list.find((x) => x.code && (up === x.code || up.startsWith(`${x.code}-`) || up.startsWith(`${x.code} `))) ?? list.find((x) => up.includes(x.name.toUpperCase())) ?? null;
  };
}

