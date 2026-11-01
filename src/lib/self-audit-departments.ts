import { DEPARTMENT_LABELS, DEPARTMENT_ORDER } from "@/lib/departments";
import type { DepartmentId } from "@/lib/supabase/types";

export type SelfAuditDepartmentScore = { departmentId: DepartmentId; label: string; pct: number | null };

/**
 * Department scores of one finalized self audit, from its per-question breakdown (question id -> %): a department
 * scores the average of its questions' scores - the same split the internal audit shows. Departments with no
 * answered question show no score.
 */
export function selfAuditDepartmentScores(breakdown: unknown, questionDept: Map<string, string | null>): SelfAuditDepartmentScore[] {
  const b = (breakdown && typeof breakdown === "object" ? breakdown : {}) as Record<string, unknown>;
  const byDept = new Map<string, number[]>();
  for (const [qid, v] of Object.entries(b)) {
    const dept = questionDept.get(qid);
    const n = typeof v === "number" ? v : Number(v);
    if (!dept || !Number.isFinite(n)) continue;
    byDept.set(dept, [...(byDept.get(dept) ?? []), n]);
  }
  // Parts is not scored as a department in the self audit.
  return DEPARTMENT_ORDER.filter((d) => d !== "parts" && [...questionDept.values()].includes(d)).map((d) => {
    const list = byDept.get(d) ?? [];
    return { departmentId: d, label: DEPARTMENT_LABELS[d], pct: list.length ? Math.round((list.reduce((s, x) => s + x, 0) / list.length) * 10) / 10 : null };
  });
}
