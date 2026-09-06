import Link from "next/link";

export default function ResultsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Results</h1>
        <p className="text-sm text-neutral-600">Choose which results to view.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/admin/results/self-audit"
          className="rounded-lg border border-neutral-200 bg-white p-6 transition hover:border-brand hover:shadow-sm"
        >
          <h2 className="text-lg font-semibold text-neutral-900">Self Audits</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Monthly branch self-audit cycles, finalized scores per branch.
          </p>
        </Link>
        <Link
          href="/admin/results/internal-audit"
          className="rounded-lg border border-neutral-200 bg-white p-6 transition hover:border-brand hover:shadow-sm"
        >
          <h2 className="text-lg font-semibold text-neutral-900">Internal Audits</h2>
          <p className="mt-1 text-sm text-neutral-600">Officer-led internal audits, finalized results per branch.</p>
        </Link>
      </div>
    </div>
  );
}
