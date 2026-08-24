export const SCORE_LEVELS = ["0", "25", "50", "75", "100"] as const;

export function scoreLevelClasses(level: string, active: boolean): string {
  if (!active) return "border-neutral-300 bg-white text-neutral-500 hover:bg-neutral-50";
  switch (level) {
    case "0":
      return "border-red-600 bg-red-600 text-white";
    case "25":
      return "border-orange-500 bg-orange-500 text-white";
    case "50":
      return "border-amber-500 bg-amber-500 text-white";
    case "75":
      return "border-lime-500 bg-lime-500 text-white";
    case "100":
      return "border-emerald-600 bg-emerald-600 text-white";
    default:
      return "border-neutral-300 bg-white text-neutral-500";
  }
}
