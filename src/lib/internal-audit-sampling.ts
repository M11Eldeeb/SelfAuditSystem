/**
 * Ported from warranty_audit_app.html's partKey()/selectWithPartCap(). Groups
 * by labor code (the reference tool's UI copy says "grouped by Main Labor
 * code, not part name", despite an internal comment there suggesting
 * otherwise) to cap how many sampled claims can share the same repair type.
 */
export function partKey(claim: { labor_code: string | null }): string {
  const labor = (claim.labor_code ?? "").trim().toUpperCase();
  return labor || "(no labor code)";
}

export function selectWithPartCap<T extends { labor_code: string | null }>(
  orderedPool: T[],
  sampleSize: number,
  maxPerPart: number | null
): T[] {
  if (!maxPerPart) return orderedPool.slice(0, sampleSize);
  const partCounts = new Map<string, number>();
  const selected: T[] = [];
  for (const claim of orderedPool) {
    if (selected.length >= sampleSize) break;
    const key = partKey(claim);
    const count = partCounts.get(key) ?? 0;
    if (count >= maxPerPart) continue;
    selected.push(claim);
    partCounts.set(key, count + 1);
  }
  return selected;
}
