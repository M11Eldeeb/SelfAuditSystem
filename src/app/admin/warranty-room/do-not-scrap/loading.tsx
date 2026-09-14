/**
 * Renders instantly on navigation while the page's data (a security-definer
 * RPC scan over the branch's claims) is still loading - without this, the
 * whole page stayed blank until the fetch resolved, which for a branch with
 * a lot of claims could take several seconds. With nothing on screen in
 * that window, clicking the link again (or the browser itself) sometimes
 * looked stuck rather than just loading.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <div className="h-4 w-40 animate-pulse rounded bg-neutral-200" />
        <div className="mt-2 h-7 w-56 animate-pulse rounded bg-neutral-200" />
        <div className="mt-2 h-4 w-96 max-w-full animate-pulse rounded bg-neutral-200" />
      </div>
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-brand" />
        Loading...
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 w-full animate-pulse rounded bg-neutral-100" />
        ))}
      </div>
    </div>
  );
}
