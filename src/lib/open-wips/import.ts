import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSheetNamed } from "@/lib/google-sheets";
import { JIAD_DEALER_CODE_SUFFIX_MAP } from "@/lib/parse-claims";
import { parseDailyHistory, parseOpenWips, type ParsedWip } from "./parse";

/** The open-WIP report (Google Sheet): tab FF3 is the data, "Daily History" the counts its own script kept before. */
export const OPEN_WIPS_SHEET_ID = "1nvLucz5f2SMhR_VBmMyid3HM4T2Y59pMMFW2E9Yuz6g";
const DATA_TAB = "FF3";
const HISTORY_TAB = "Daily History";

export type OpenWipsImportResult = { rows: number; opened: number; closed: number; history?: number } | { error: string };

const todayKsa = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

async function branchIds() {
  const { data } = await createAdminClient().from("self_audit_branches").select("id, code");
  const byCode = new Map((data ?? []).filter((b) => b.code).map((b) => [b.code!.toUpperCase(), b.id]));
  return (dealer: string) => byCode.get(JIAD_DEALER_CODE_SUFFIX_MAP[dealer] ?? "") ?? null;
}

/**
 * Replaces the snapshot with `rows` (a WIP missing from the new report was invoiced: it leaves), keeps each WIP's
 * first-seen day, and writes today's count per branch + operator.
 */
export async function saveOpenWips(rows: ParsedWip[], source: "sheet" | "upload", fileName: string | null, byName: string | null): Promise<OpenWipsImportResult> {
  if (!rows.length) return { error: "The report has no open WIPs." };
  const admin = createAdminClient();
  const branchOf = await branchIds();
  const prev = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("self_audit_open_wips").select("key, first_seen").range(from, from + 999);
    if (error) return { error: error.message };
    for (const r of data ?? []) prev.set(r.key, r.first_seen);
    if ((data ?? []).length < 1000) break;
  }
  const today = todayKsa();
  const now = new Date().toISOString();
  const full = rows.map((r) => ({ ...r, branch_id: branchOf(r.dealer_code), first_seen: prev.get(r.key) ?? today, imported_at: now }));
  for (let i = 0; i < full.length; i += 500) {
    const { error } = await admin.from("self_audit_open_wips").upsert(full.slice(i, i + 500), { onConflict: "key" });
    if (error) return { error: error.message };
  }
  const keep = new Set(rows.map((r) => r.key));
  const gone = [...prev.keys()].filter((k) => !keep.has(k));
  for (let i = 0; i < gone.length; i += 200) {
    const { error } = await admin.from("self_audit_open_wips").delete().in("key", gone.slice(i, i + 200));
    if (error) return { error: error.message };
  }

  // Today's count per branch + operator (the last import of the day wins).
  const counts = new Map<string, { day: string; dealer_code: string; operator: string; branch_id: string | null; count: number; source: string }>();
  for (const r of rows) {
    const op = r.operator ?? "No operator";
    const k = `${r.dealer_code}|${op}`;
    const c = counts.get(k) ?? { day: today, dealer_code: r.dealer_code, operator: op, branch_id: branchOf(r.dealer_code), count: 0, source: "portal" };
    c.count++;
    counts.set(k, c);
  }
  await admin.from("self_audit_open_wip_daily").delete().eq("day", today);
  const { error: dailyError } = await admin.from("self_audit_open_wip_daily").insert([...counts.values()]);
  if (dailyError) return { error: dailyError.message };

  const opened = rows.filter((r) => !prev.has(r.key)).length;
  await admin.from("self_audit_open_wip_imports").insert({ source, file_name: fileName, rows: rows.length, opened: prev.size ? opened : 0, closed: gone.length, imported_by_name: byName });
  return { rows: rows.length, opened: prev.size ? opened : 0, closed: gone.length };
}

/** Earlier days from the sheet's own "Daily History" (never over a day the portal counted itself). */
async function seedHistory(values: unknown[][] | null): Promise<number> {
  if (!values) return 0;
  const hist = parseDailyHistory(values);
  if (!hist.length) return 0;
  const admin = createAdminClient();
  const branchOf = await branchIds();
  const { data: own } = await admin.from("self_audit_open_wip_daily").select("day").eq("source", "portal");
  const ownDays = new Set((own ?? []).map((d) => d.day));
  const rows = hist.filter((h) => !ownDays.has(h.day)).map((h) => ({ ...h, branch_id: branchOf(h.dealer_code), source: "sheet" }));
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await admin.from("self_audit_open_wip_daily").upsert(rows.slice(i, i + 1000), { onConflict: "day,dealer_code,operator" });
    if (error) throw new Error(error.message);
  }
  return rows.length;
}

/** Reads FF3 (and the Daily History) from the Google Sheet. Used by the Refresh button and the twice-daily job. */
export async function importOpenWipsFromSheet(byName: string | null = null): Promise<OpenWipsImportResult> {
  try {
    const [data, history] = await Promise.all([readSheetNamed(OPEN_WIPS_SHEET_ID, DATA_TAB), readSheetNamed(OPEN_WIPS_SHEET_ID, HISTORY_TAB)]);
    if (!data) return { error: `The sheet has no "${DATA_TAB}" tab.` };
    const seeded = await seedHistory(history);
    const r = await saveOpenWips(parseOpenWips(data), "sheet", "Google Sheet (FF3)", byName);
    return "error" in r ? r : { ...r, history: seeded };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not read the open WIPs sheet." };
  }
}
