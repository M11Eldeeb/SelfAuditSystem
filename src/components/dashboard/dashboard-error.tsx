"use client";

/** Route-level fallback for the KPI dashboard instead of the generic server error page. */
export function DashboardError({ retry }: { retry: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl bg-white p-10 text-center ring-1 ring-[#dce9ff]/60">
      <p className="font-semibold text-[#0b1c30]">The dashboard couldn&apos;t load</p>
      <p className="text-sm text-[#575e70]">The database was busy for a moment. Trying again usually works.</p>
      <button
        type="button"
        onClick={() => retry()}
        className="rounded-lg bg-[#c4121a] px-4 py-1.5 text-sm font-bold text-white transition hover:bg-[#9a000d]"
      >
        Try again
      </button>
    </div>
  );
}
