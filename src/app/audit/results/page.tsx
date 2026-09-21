import Link from "next/link";

export default function BranchResultsHubPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Results</h1>
        <p className="text-sm text-neutral-600">Choose which results to view.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/audit/results/self-audit"
          className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-6 transition hover:border-brand hover:shadow-md hover:-translate-y-0.5"
        >
          <h2 className="text-lg font-semibold text-neutral-900">Self Audits</h2>
          <p className="mt-1 text-sm text-neutral-600">Your branch&apos;s finalized self-audit results.</p>
        </Link>
        <Link
          href="/audit/results/internal-audit"
          className="rounded-xl border border-neutral-200/70 bg-white shadow-sm p-6 transition hover:border-brand hover:shadow-md hover:-translate-y-0.5"
        >
          <h2 className="text-lg font-semibold text-neutral-900">Internal Audits</h2>
          <p className="mt-1 text-sm text-neutral-600">Your branch&apos;s finalized internal-audit results.</p>
        </Link>
      </div>
    </div>
  );
}
