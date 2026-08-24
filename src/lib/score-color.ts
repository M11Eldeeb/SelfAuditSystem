export function scoreBadgeClasses(score: number): string {
  if (score >= 90) return "bg-emerald-50 text-emerald-800";
  if (score >= 75) return "bg-amber-50 text-amber-800";
  return "bg-red-50 text-red-800";
}

export function scoreBarClasses(score: number): string {
  if (score >= 90) return "bg-emerald-500";
  if (score >= 75) return "bg-amber-500";
  return "bg-red-500";
}
