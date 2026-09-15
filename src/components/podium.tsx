import type { StandingsEntry } from "@/lib/standings";

const RANK_STYLE = [
  {
    badge: "bg-linear-to-b from-amber-300 to-amber-500 text-amber-950 shadow-sm shadow-amber-500/40",
    bar: "bg-linear-to-t from-amber-400 to-amber-300",
    height: "h-28",
  },
  {
    badge: "bg-linear-to-b from-neutral-200 to-neutral-400 text-neutral-800 shadow-sm shadow-neutral-400/40",
    bar: "bg-linear-to-t from-neutral-300 to-neutral-200",
    height: "h-20",
  },
  {
    badge: "bg-linear-to-b from-orange-200 to-orange-400 text-orange-950 shadow-sm shadow-orange-400/40",
    bar: "bg-linear-to-t from-orange-300 to-orange-200",
    height: "h-14",
  },
];

export function Podium({ entries, hideScores = false }: { entries: StandingsEntry[]; hideScores?: boolean }) {
  const top3 = entries.slice(0, 3);
  if (top3.length === 0) return null;

  // Classic podium arrangement: 2nd on the left, 1st in the center, 3rd on the right.
  const visualOrder = [1, 0, 2].filter((i) => top3[i] !== undefined);

  return (
    <div className="flex items-end justify-center gap-4 rounded-xl border border-neutral-200/70 bg-white p-6 shadow-sm sm:gap-8">
      {visualOrder.map((i) => {
        const entry = top3[i];
        const style = RANK_STYLE[i];
        return (
          <div key={entry.branchId} className="flex w-24 flex-col items-center gap-2 sm:w-32">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ring-2 ring-white ${style.badge}`}
            >
              {i + 1}
            </span>
            <span className="w-full truncate text-center text-sm font-medium text-neutral-900">
              {entry.name}
            </span>
            {!hideScores && (
              <span className="text-xs font-medium text-neutral-500">{entry.avg}%</span>
            )}
            <div className={`w-full rounded-t-lg ${style.bar} ${style.height}`} />
          </div>
        );
      })}
    </div>
  );
}
