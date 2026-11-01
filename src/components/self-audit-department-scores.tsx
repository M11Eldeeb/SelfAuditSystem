import type { SelfAuditDepartmentScore } from "@/lib/self-audit-departments";

const barColor = (pct: number | null) => (pct != null && pct >= 90 ? "bg-emerald-500" : pct != null && pct >= 75 ? "bg-amber-500" : "bg-red-500");

/** The department bars of one self audit (same look as the internal audit report). */
export function SelfAuditDepartmentScores({ scores, month }: { scores: SelfAuditDepartmentScore[]; month: string }) {
  if (!scores.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-neutral-900">
        Department scores <span className="text-sm font-normal text-neutral-500">· {month}</span>
      </h2>
      <div className="space-y-2 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
        {scores.map((d) => (
          <div key={d.departmentId} className="flex items-center gap-3">
            <span className="w-48 shrink-0 text-sm text-neutral-900">{d.label}</span>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-neutral-100">
              <div className={`h-full rounded-full ${barColor(d.pct)}`} style={{ width: `${Math.min(d.pct ?? 0, 100)}%` }} />
            </div>
            <span className="w-16 text-right text-sm font-medium text-neutral-900">{d.pct != null ? `${d.pct}%` : "—"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** One small score cell per department, for the results table. */
export function DepartmentCells({ scores, departments }: { scores: SelfAuditDepartmentScore[] | null; departments: { departmentId: string }[] }) {
  return (
    <>
      {departments.map((d) => {
        const s = scores?.find((x) => x.departmentId === d.departmentId);
        return (
          <td key={d.departmentId} className="px-3 py-2 text-right tabular-nums">
            {s?.pct != null ? (
              <span className={`font-medium ${s.pct >= 90 ? "text-emerald-700" : s.pct >= 75 ? "text-amber-700" : "text-red-700"}`}>{s.pct}%</span>
            ) : (
              <span className="text-neutral-300">—</span>
            )}
          </td>
        );
      })}
    </>
  );
}
