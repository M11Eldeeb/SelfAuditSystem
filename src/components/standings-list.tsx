import type { StandingsEntry } from "@/lib/standings";
import { scoreBarClasses } from "@/lib/score-color";

const RANK_BADGE = [
  "bg-amber-400 text-amber-950",
  "bg-neutral-300 text-neutral-800",
  "bg-orange-300 text-orange-950",
];

export function StandingsList({ entries }: { entries: StandingsEntry[] }) {
  if (entries.length === 0) return null;
  const topScore = entries[0].avg;

  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4">
      {entries.map((e, i) => {
        const diff = Math.round((e.avg - topScore) * 10) / 10;
        return (
          <div key={e.branchId} className="flex items-center gap-3">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                i < 3 ? RANK_BADGE[i] : "bg-neutral-100 text-neutral-500"
              }`}
            >
              {i + 1}
            </span>
            <span className="w-40 shrink-0 truncate text-sm text-neutral-900">{e.name}</span>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-neutral-100">
              <div
                className={`h-full rounded-full ${scoreBarClasses(e.avg)}`}
                style={{ width: `${Math.min(e.avg, 100)}%` }}
              />
            </div>
            <span className="w-16 text-right text-sm font-medium text-neutral-900">{e.avg}%</span>
            <span className="w-24 text-right text-xs text-neutral-500">{i === 0 ? "Best" : `${diff} pts`}</span>
          </div>
        );
      })}
    </div>
  );
}
