// Shown instantly while the dashboard's data loads, laid out like the real
// page so nothing jumps when it arrives.
export function DashboardSkeleton() {
  const block = "animate-pulse rounded-xl bg-white ring-1 ring-[#dce9ff]/60";
  return (
    <div className="relative left-1/2 grid w-[min(96rem,calc(100vw-2rem))] -translate-x-1/2 grid-cols-1 gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <div className={`${block} h-72`} />
      <div className="space-y-5">
        <div className={`${block} h-36`} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`${block} h-40`} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className={`${block} h-72 lg:col-span-7`} />
          <div className={`${block} h-72 lg:col-span-5`} />
        </div>
      </div>
    </div>
  );
}
