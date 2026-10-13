// Shared by the browser and the server - no "server-only" here on purpose.

/** Destroy-evidence videos go straight from the browser to Google Drive, so the limit is generous. */
export const EVIDENCE_MAX_VIDEOS = 30;
export const EVIDENCE_MAX_VIDEO_BYTES = 1024 * 1024 * 1024; // 1 GB each

/** "10-2026" for a cycle month stored as "2026-10-01": the name of the month's folder in Drive. */
export function evidenceMonthLabel(cycleMonth: string): string {
  const [year, month] = cycleMonth.slice(0, 7).split("-");
  return `${month}-${year}`;
}
