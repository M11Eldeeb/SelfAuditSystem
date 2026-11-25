// The period of the Quality Dashboard: how far back from today, counted on the day the QC form was submitted (Saudi time).

export const QC_RANGES = [
  { key: "1w", label: "1 week" },
  { key: "1m", label: "1 month" },
  { key: "3m", label: "3 months" },
  { key: "6m", label: "6 months" },
  { key: "1y", label: "1 year" },
  { key: "all", label: "All time" },
] as const;
export type QcRangeKey = (typeof QC_RANGES)[number]["key"];
export const DEFAULT_QC_RANGE: QcRangeKey = "1m";

export function parseQcRange(value: string | string[] | undefined, fallback: QcRangeKey = DEFAULT_QC_RANGE): QcRangeKey {
  const v = Array.isArray(value) ? value[0] : value;
  return QC_RANGES.find((r) => r.key === v)?.key ?? fallback;
}

const KSA_OFFSET_MS = 3 * 3_600_000;
/** A moment as its Saudi calendar day, "2026-11-25". */
export const ksaDay = (ms: number) => new Date(ms + KSA_OFFSET_MS).toISOString().slice(0, 10);

/**
 * The first moment of the period (00:00 Saudi time of its first day), or null for "All time". Today is always the last
 * day: 1 week = the last 7 days including today; 1 month = from the same date last month, and so on.
 */
export function qcRangeStart(range: QcRangeKey, nowMs: number = Date.now()): Date | null {
  if (range === "all") return null;
  const today = new Date(`${ksaDay(nowMs)}T00:00:00Z`); // Saudi "today" as a UTC date
  if (range === "1w") today.setUTCDate(today.getUTCDate() - 6);
  else {
    const months = range === "1m" ? 1 : range === "3m" ? 3 : range === "6m" ? 6 : 12;
    const day = today.getUTCDate();
    today.setUTCDate(1);
    today.setUTCMonth(today.getUTCMonth() - months);
    // 31 March - 1 month = 28 Feb (not 3 March)
    const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
    today.setUTCDate(Math.min(day, last));
  }
  return new Date(today.getTime() - KSA_OFFSET_MS);
}
