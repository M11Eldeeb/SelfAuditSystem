"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestScrapGeneration } from "./scrap-generation-actions";
import { currentYearMonth } from "@/lib/month";

type Generation = {
  batch_name: string | null;
  status: "queued" | "running" | "done" | "failed";
  requested_at: string;
  finished_at: string | null;
  created_count: number | null;
  error: string | null;
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }) : "—";

/**
 * Scrap list generation is manual: uploading claims (e.g. for the KPI
 * dashboard) no longer changes the flagged-to-scrap list on its own.
 */
export function ScrapGenerationCard({
  last,
  latestBatchName,
  cycleMonth,
}: {
  last: Generation | null;
  latestBatchName: string | null;
  /** The newest warranty room cycle's month ("2026-10"), which newly flagged parts will join. Null if no cycle exists. */
  cycleMonth: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inProgress = last?.status === "queued" || last?.status === "running";

  // While the database job is working, check back every few seconds.
  useEffect(() => {
    if (!inProgress) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [inProgress, router]);

  const generate = () => {
    if (!latestBatchName) return;
    const cycleNote = cycleMonth ? ` Newly flagged parts will join the ${cycleMonth} cycle.` : " There is no warranty room cycle yet.";
    if (!window.confirm(`Generate the scrap list from "${latestBatchName}"? Claims past the 90-day hold will be flagged to scrap and branches will see them.${cycleNote}`)) return;
    setError(null);
    startTransition(async () => {
      const res = await requestScrapGeneration();
      if (res.error) setError(res.error);
      else router.refresh();
    });
  };

  return (
    <section className="space-y-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-neutral-900">3. Scrap list generation</h2>
          <p className="text-sm text-neutral-600">
            Runs only when you press the button - uploading a claims batch doesn&apos;t change the scrap list by itself.
          </p>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={isPending || inProgress || !latestBatchName}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark disabled:opacity-50"
        >
          {inProgress ? "Generating…" : "Generate scrap list"}
        </button>
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg bg-neutral-50 p-3">
          <div className="text-xs font-semibold text-neutral-500 uppercase">Last generated</div>
          {last ? (
            <>
              <div className="font-medium text-neutral-900">{last.batch_name ?? "—"}</div>
              <div className="text-xs text-neutral-600">
                {last.status === "done" && <>{fmt(last.finished_at)}{last.created_count != null && ` · ${last.created_count} new scrap requests`}</>}
                {last.status === "queued" && <>Queued {fmt(last.requested_at)} - starts within a minute</>}
                {last.status === "running" && <>Running since {fmt(last.requested_at)}…</>}
                {last.status === "failed" && <span className="text-red-600">Failed: {last.error}</span>}
              </div>
            </>
          ) : (
            <div className="text-neutral-500">Never</div>
          )}
        </div>
        <div className="rounded-lg bg-neutral-50 p-3">
          <div className="text-xs font-semibold text-neutral-500 uppercase">Will use latest claims batch</div>
          <div className="font-medium text-neutral-900">{latestBatchName ?? "No claims batch uploaded"}</div>
        </div>
      </div>
      <p className={`rounded-lg px-3 py-2 text-sm ${cycleMonth && cycleMonth >= currentYearMonth() ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
        {cycleMonth ? (
          <>
            Newly flagged parts will join the <span className="font-semibold">{cycleMonth}</span> cycle.
            {cycleMonth < currentYearMonth() && " That is not the current month - generate the new cycle first (step 2) if this run belongs to the current month."}
          </>
        ) : (
          "There is no warranty room cycle yet - generate one first (step 2)."
        )}
      </p>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}
