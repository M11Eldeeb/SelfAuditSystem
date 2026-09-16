export function UploadProgressBar({ label, percent }: { label: string; percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="max-w-sm space-y-1">
      <div className="flex items-center justify-between text-xs text-neutral-600">
        <span>{label}</span>
        <span className="font-medium tabular-nums">{Math.round(clamped)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-300 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
