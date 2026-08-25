import type { StandingsEntry } from "@/lib/standings";

const RANK_STYLE = [
  { badge: "bg-amber-400 text-amber-950", bar: "bg-amber-400", height: "h-28" },
  { badge: "bg-neutral-300 text-neutral-800", bar: "bg-neutral-300", height: "h-20" },
  { badge: "bg-orange-300 text-orange-950", bar: "bg-orange-300", height: "h-14" },
];

export function Podium({ entries }: { entries: StandingsEntry[] }) {
  const top3 = entries.slice(0, 3);
  if (top3.length === 0) return null;

  // Classic podium arrangement: 2nd on the left, 1st in the center, 3rd on the right.
  const visualOrder = [1, 0, 2].filter((i) => top3[i] !== undefined);

  return (
    <div className="flex items-end justify-center gap-4 rounded-lg border border-neutral-200 bg-white p-6 sm:gap-8">
      {visualOrder.map((i) => {
        const entry = top3[i];
        const style = RANK_STYLE[i];
        return (
          <div key={entry.branchId} className="flex w-24 flex-col items-center gap-2 sm:w-32">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${style.badge}`}
            >
              {i + 1}
            </span>
            <span className="w-full truncate text-center text-sm font-medium text-neutral-900">
              {entry.name}
            </span>
            <span className="text-xs text-neutral-500">{entry.avg}%</span>
            <div className={`w-full rounded-t-md ${style.bar} ${style.height}`} />
          </div>
        );
      })}
    </div>
  );
}
